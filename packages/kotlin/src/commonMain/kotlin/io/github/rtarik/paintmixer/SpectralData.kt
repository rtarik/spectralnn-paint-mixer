package io.github.rtarik.paintmixer
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Spectral color conversion utilities for physically-based subtractive mixing.
 *
 * We reconstruct a pigment-like reflectance curve from sRGB using a **dual
 * sigmoid** spectral model:
 *
 *     R(λ) = α·σ(a₀ + a₁·t + a₂·t²) + (1−α)·σ(b₀ + b₁·t + b₂·t²)
 *
 * where t is normalised wavelength [0,1] over 380–750 nm and σ is the logistic
 * function.  The two lobes are fitted per-colour via Gauss-Newton optimisation
 * against the target XYZ tristimulus values.
 *
 * A single sigmoid can only produce one spectral transition.  The dual model
 * can represent double-peaked reflectance curves (e.g. purple = red peak +
 * blue peak) that are essential for accurate subtractive mixing of
 * complementary pigments.
 *
 * For simple colours (red, yellow, blue) the regularisation term pulls α→1,
 * collapsing the model back to a single sigmoid.  The second lobe only
 * activates when it materially reduces the XYZ residual.
 */
internal object SpectralData {

    /** Number of spectral samples (380–750 nm, 10 nm steps). */
    private const val SPECTRAL_SAMPLES = 38

    /**
     * Length of the linear mixing vector returned by [colorToMixSpace]:
     * `[K(0..n-1), S(0..n-1)]`.
     */
    const val N = SPECTRAL_SAMPLES * 2

    /** Prevents singularities in K/S and reflectance conversion. */
    private const val EPSILON = 1e-6

    /** Exact neutrals are best represented by flat reflectance curves. */
    private const val NEUTRAL_LINEAR_TOLERANCE = 1e-4

    /** Maximum Gauss-Newton iterations per fitting phase. */
    private const val MAX_ITERATIONS = 20

    /**
     * The learned basis deformations stay inside a conservative fraction of the
     * exact per-basis headroom so we preserve physically valid reflectances
     * without letting the optimizer freely rewrite the ported spectral.js bases.
     */
    private const val BASIS_DEFORMATION_FRACTION = 0.35

    /**
     * Active mixing parameters. Replace this instance to experiment with
     * different parameter sets (e.g. via an optimizer).
     */
    var params = DefaultModelArtifact.runtime.mixingParameters

    internal data class ComplementaryMixProfile(
        val chroma: Double,
        val redScore: Double,
        val blueScore: Double,
        val yellowScore: Double,
    )

    internal data class OpponentMixStress(
        val violet: Double,
        val green: Double,
    )

    /** Normalised wavelength parameters t ∈ [0, 1] for 380–750 nm, 10 nm steps. */
    private val WAVELENGTH_T = DoubleArray(SPECTRAL_SAMPLES) { i ->
        i.toDouble() / (SPECTRAL_SAMPLES - 1)
    }

    /**
     * D65-illuminated color matching functions already premultiplied for the
     * spectral grid, adapted from a D65-specific spectral mixing prototype.
     */
    private val X_BAR = doubleArrayOf(
        6.4691998957636e-05, 0.00021940989981324543, 0.0011205743509342526, 0.003766613411711093,
        0.011880553603799004, 0.023286442419177128, 0.034559418196974744, 0.03722379011620067,
        0.03241837610914861, 0.021233205609381033, 0.01049099076854208, 0.003295837579793109,
        0.0005070351633801336, 0.0009486742057141478, 0.006273718099831793, 0.0168646241897775,
        0.028689649025980982, 0.04267481246917313, 0.05625474813113776, 0.06947039726771581,
        0.08305315169982916, 0.08612609630022569, 0.09046613768477696, 0.08500386505912774,
        0.0709066691074488, 0.050628891637364504, 0.03547396188526398, 0.021468210259706556,
        0.012516456761911689, 0.006804581639016529, 0.0034645657946526308, 0.0014976097506959416,
        0.000769700480928044, 0.00040736805813154517, 0.0001690104031613905, 9.5224515036545e-05,
        4.903098729584765e-05, 1.999614922216866e-05,
    )

    private val Y_BAR = doubleArrayOf(
        1.8442894439676924e-06, 6.205323586516486e-06, 3.100960467994158e-05, 0.00010474838492692305,
        0.00035364052995383256, 0.0009514714056444336, 0.0022822631748317997, 0.004207329043473007,
        0.006688798371901364, 0.009888396019356503, 0.015249451449631114, 0.02141831094497228,
        0.033422930157506775, 0.05131001349185122, 0.070402083939949, 0.0878387072603517,
        0.0942490536184086, 0.09795667027189314, 0.09415218568626084, 0.08678102374867531,
        0.07885653386320132, 0.06352670262035551, 0.05374141675682006, 0.042646064357411986,
        0.03161734927927079, 0.020885205921391023, 0.01386011013601517, 0.008102640203839865,
        0.004630102258802989, 0.0024913800051319097, 0.0012593033677377537, 0.0005416465221680035,
        0.00027795289200670086, 0.00014710806738544828, 6.103274729272546e-05, 3.43873229523396e-05,
        1.7705986005253943e-05, 7.220974912993785e-06,
    )

    private val Z_BAR = doubleArrayOf(
        0.00030501714763797594, 0.0010368066663574284, 0.0053131363323992, 0.01795439258995359,
        0.05707758153454857, 0.11365161893628682, 0.17335872618354975, 0.19620657555865664,
        0.18608237070629596, 0.13995047538320737, 0.08917452942686492, 0.04789621135170755,
        0.02814562539579518, 0.01613766229505142, 0.0077591019215213644, 0.00429614837366175,
        0.002005509212215613, 0.0008614711098801786, 0.0003690387177652434, 0.000191428728857372,
        0.00014955558589748968, 9.231092851042412e-05, 6.813491823368628e-05, 2.8826365569622417e-05,
        1.5767182055279397e-05, 3.940604102707517e-06, 1.5840125869731628e-06, 0.0,
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    )

    private val SRGB_D65_TO_XYZ = arrayOf(
        doubleArrayOf(0.4123907992659593, 0.3575843393838777, 0.1804807884018343),
        doubleArrayOf(0.21263900587151033, 0.7151686787677553, 0.07219231536073373),
        doubleArrayOf(0.019330818715591832, 0.11919477979462595, 0.9505321522496605),
    )

    private val XYZ_TO_SRGB_D65 = arrayOf(
        doubleArrayOf(3.2409699419045253, -1.537383177570097, -0.4986107602930039),
        doubleArrayOf(-0.9692436362808824, 1.8759675015077237, 0.041555057407175744),
        doubleArrayOf(0.055630079696993795, -0.20397695888897688, 1.0569715142428786),
    )

    // Fixed reflectance bases ported from spectral.js, the same library used
    // to generate the ground-truth dataset.
    private val BASE_W = doubleArrayOf(
        1.00116072718764, 1.00116065159728, 1.00116031922747, 1.00115867270789,
        1.00115259844552, 1.00113252528998, 1.00108500663327, 1.00099687889453,
        1.00086525152274, 1.0006962900094, 1.00050496114888, 1.00030808187992,
        1.00011966602013, 0.999952765968407, 0.999821836899297, 0.999738609557593,
        0.999709551639612, 0.999731930210627, 0.999799436346195, 0.999900330316671,
        1.00002040652611, 1.00014478793658, 1.00025997903412, 1.00035579697089,
        1.00042753780269, 1.00047623344888, 1.00050720967508, 1.00052519156373,
        1.00053509606896, 1.00054022097482, 1.00054272816784, 1.00054389569087,
        1.00054448212151, 1.00054476959992, 1.00054489887762, 1.00054496254689,
        1.00054498927058, 1.000544996993,
    )

    private val BASE_C = doubleArrayOf(
        0.970585001322962, 0.970592498143425, 0.970625348729891, 0.970786806119017,
        0.971368673228248, 0.973163230621252, 0.976740223158765, 0.981587605491377,
        0.986280265652949, 0.989949147689134, 0.99249270153842, 0.994145680405256,
        0.995183975033212, 0.995756750110818, 0.99591281828671, 0.995606157834528,
        0.994597600961854, 0.99221571549237, 0.986236452783249, 0.967943337264541,
        0.891285004244943, 0.536202477862053, 0.154108119001878, 0.0574575093228929,
        0.0315349873107007, 0.0222633920086335, 0.0182022841492439, 0.016299055973264,
        0.0153656239334613, 0.0149111568733976, 0.0146954339898235, 0.0145964146717719,
        0.0145470156699655, 0.0145228771899495, 0.0145120341118965, 0.0145066940939832,
        0.0145044507314479, 0.0145038009464639,
    )

    private val BASE_M = doubleArrayOf(
        0.990673557319988, 0.990671524961979, 0.990662582353421, 0.990618107644795,
        0.99045148087871, 0.989871081400204, 0.98828660875964, 0.984290692797504,
        0.973934905625306, 0.941817838460145, 0.817390326195156, 0.432472805065729,
        0.13845397825887, 0.0537347216940033, 0.0292174996673231, 0.021313651750859,
        0.0201349530181136, 0.0241323096280662, 0.0372236145223627, 0.0760506552706601,
        0.205375471942399, 0.541268903460439, 0.815841685086486, 0.912817704123976,
        0.946339830166962, 0.959927696331991, 0.966260595230312, 0.969325970058424,
        0.970854536721399, 0.971605066528128, 0.971962769757392, 0.972127272274509,
        0.972209417745812, 0.972249577678424, 0.972267621998742, 0.97227650946215,
        0.972280243306874, 0.97228132482656,
    )

    private val BASE_Y = doubleArrayOf(
        0.0210523371789306, 0.0210564627517414, 0.0210746178695038, 0.0211649058448753,
        0.0215027957272504, 0.0226738799041561, 0.0258235649693629, 0.0334879385639851,
        0.0519069663740307, 0.100749014833473, 0.239129899706847, 0.534804312272748,
        0.79780757864303, 0.911449894067384, 0.953797963004507, 0.971241615465429,
        0.979303123807588, 0.983380119507575, 0.985461246567755, 0.986435046976605,
        0.986738250670141, 0.986617882445032, 0.986277776758643, 0.985860592444056,
        0.98547492767621, 0.985176934765558, 0.984971574014181, 0.984846303415712,
        0.984775351811199, 0.984738066625265, 0.984719648311765, 0.984711023391939,
        0.984706683300676, 0.984704554393091, 0.98470359630937, 0.984703124077552,
        0.98470292561509, 0.984702868122795,
    )

    private val BASE_R = doubleArrayOf(
        0.0315605737777207, 0.0315520718330149, 0.0315148215513658, 0.0313318044982702,
        0.0306729857725527, 0.0286480476989607, 0.0246450407045709, 0.0192960753663651,
        0.0142066612220556, 0.0102942608878609, 0.0076191460521811, 0.005898041083542,
        0.0048233247781713, 0.0042298748350633, 0.0040599171299341, 0.0043533695594676,
        0.0053434425970201, 0.0076917201010463, 0.0135969795736536, 0.0316975442661115,
        0.107861196355249, 0.463812603168704, 0.847055405272011, 0.943185409393918,
        0.968862150696558, 0.978030667473603, 0.982043643854306, 0.983923623718707,
        0.984845484154382, 0.985294275814596, 0.985507295219825, 0.985605071539837,
        0.985653849933578, 0.985677685033883, 0.985688391806122, 0.985693664690031,
        0.985695879848205, 0.985696521463762,
    )

    private val BASE_G = doubleArrayOf(
        0.0095560747554212, 0.0095581580120851, 0.0095673245444588, 0.0096129126297349,
        0.0097837090401843, 0.010378622705871, 0.0120026452378567, 0.0160977721473922,
        0.026706190223168, 0.0595555440185881, 0.186039826532826, 0.570579820116159,
        0.861467768400292, 0.945879089767658, 0.970465486474305, 0.97841363028445,
        0.979589031411224, 0.975533536908632, 0.962288755397813, 0.92312157451312,
        0.793434018943111, 0.459270135902429, 0.185574103666303, 0.0881774959955372,
        0.05436302287667, 0.0406288447060719, 0.034221520431697, 0.0311185790956966,
        0.0295708898336134, 0.0288108739348928, 0.0284486271324597, 0.0282820301724731,
        0.0281988376490237, 0.0281581655342037, 0.0281398910216386, 0.0281308901665811,
        0.0281271086805816, 0.0281260133612096,
    )

    private val BASE_B = doubleArrayOf(
        0.979404752502014, 0.97940070684313, 0.979382903470261, 0.979294364945594,
        0.97896301460857, 0.977814466694043, 0.974724321133836, 0.967198482343973,
        0.949079657530575, 0.900850128940977, 0.76315044546224, 0.465922171649319,
        0.201263280451005, 0.0877524413419623, 0.0457176793291679, 0.0284706050521843,
        0.020527176756985, 0.0165302792310211, 0.0145135107212858, 0.0136003508637687,
        0.0133604258769571, 0.013548894314568, 0.0139594356366992, 0.014443425575357,
        0.0148854440621406, 0.0152254296999746, 0.0154592848180209, 0.0156018026485961,
        0.0156824871281936, 0.0157248764360615, 0.0157458108784121, 0.0157556123350225,
        0.0157605443964911, 0.0157629637515278, 0.0157640525629106, 0.015764589232951,
        0.0157648147772649, 0.0157648801149616,
    )

    private val XYZ_BASIS = arrayOf(X_BAR, Y_BAR, Z_BAR)
    private val XYZ_GRAM = Array(3) { row ->
        DoubleArray(3) { col -> spectralDot(XYZ_BASIS[row], XYZ_BASIS[col]) }
    }
    private val BASE_MAGENTA_LUMINANCE = spectralDot(BASE_M, Y_BAR).coerceAtLeast(EPSILON)
    private val BASE_GREEN_LUMINANCE = spectralDot(BASE_G, Y_BAR).coerceAtLeast(EPSILON)

    private val RED_RESIDUAL_BASIS = xyzNullResidualBasis(
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val t = WAVELENGTH_T[index]
            gaussian(t, 0.84, 0.12) -
                0.22 * gaussian(t, 0.55, 0.18) -
                0.08 * gaussian(t, 0.22, 0.16)
        }
    )

    private val BLUE_RESIDUAL_BASIS = xyzNullResidualBasis(
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val t = WAVELENGTH_T[index]
            gaussian(t, 0.16, 0.10) -
                0.22 * gaussian(t, 0.46, 0.18) -
                0.08 * gaussian(t, 0.78, 0.16)
        }
    )

    private val MAGENTA_RESIDUAL_BASIS = xyzNullResidualBasis(
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val t = WAVELENGTH_T[index]
            gaussian(t, 0.15, 0.10) +
                gaussian(t, 0.85, 0.10) -
                0.30 * gaussian(t, 0.52, 0.16)
        }
    )

    private val BASIS_BLUE_REGION_RESIDUAL = xyzNullResidualBasis(
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val t = WAVELENGTH_T[index]
            gaussian(t, 0.18, 0.09) -
                0.40 * gaussian(t, 0.50, 0.18) -
                0.10 * gaussian(t, 0.82, 0.20)
        }
    )

    private val BASIS_GREEN_REGION_RESIDUAL = xyzNullResidualBasis(
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val t = WAVELENGTH_T[index]
            gaussian(t, 0.52, 0.10) -
                0.22 * gaussian(t, 0.20, 0.18) -
                0.22 * gaussian(t, 0.84, 0.18)
        }
    )

    private val BASIS_RED_REGION_RESIDUAL = xyzNullResidualBasis(
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val t = WAVELENGTH_T[index]
            gaussian(t, 0.84, 0.09) -
                0.40 * gaussian(t, 0.52, 0.18) -
                0.10 * gaussian(t, 0.18, 0.20)
        }
    )

    // Residual reflectance directions derived from the current worst-case
    // dataset clusters. These intentionally encode the RGB-space correction
    // needed to move spectral.js-like mixes toward the artistically-adjusted
    // ground-truth targets.
    private val LEARNED_VIOLET_MIX_RESIDUAL_BASIS = doubleArrayOf(
        0.640431, 0.640025, 0.638115, 0.631121, 0.610437, 0.562710, 0.476945, 0.354893,
        0.215516, 0.093330, 0.026629, 0.023023, 0.043984, 0.052873, 0.057589, 0.089760,
        0.175778, 0.337485, 0.590700, 0.880555, -1.000000, 0.748769, 0.237147, 0.217181,
        0.467039, 0.574951, 0.621650, 0.642930, 0.652978, 0.657790, 0.660088, 0.661173,
        0.661688, 0.661936, 0.662055, 0.662110, 0.662134, 0.662142,
    )

    private val LEARNED_GREEN_MIX_RESIDUAL_BASIS = doubleArrayOf(
        0.317766, 0.316902, 0.312858, 0.298263, 0.256508, 0.166427, 0.024853, 0.123112,
        0.175903, 0.035602, 0.260777, 0.496946, 0.458915, 0.143812, 0.275972, 0.639059,
        0.882598, 1.000000, 0.965870, 0.689169, 0.149861, 0.371510, 0.531059, 0.375478,
        0.184885, 0.082998, 0.043903, 0.031020, 0.027251, 0.026289, 0.026088, 0.026065,
        0.026072, 0.026080, 0.026085, 0.026087, 0.026088, 0.026089,
    )

    private val LEARNED_DARK_VIOLET_MIX_RESIDUAL_BASIS = doubleArrayOf(
        0.286896, 0.287145, 0.288318, 0.292607, 0.305258, 0.334284, 0.385882, 0.457763,
        0.536823, 0.603691, 0.643188, 0.657491, 0.665094, 0.678269, 0.689329, 0.682268,
        0.644649, 0.565778, 0.435563, 0.275495, 0.187931, 0.287750, 0.535828, 0.769025,
        0.900319, 0.956671, 0.980392, 0.990878, 0.995705, 0.997977, 0.999049, 0.999553,
        0.999790, 0.999905, 0.999960, 0.999985, 0.999996, 1.000000,
    )

    private val LEARNED_VIOLET_KS_RESIDUAL_BASIS = doubleArrayOf(
        0.410708, 0.410504, 0.409536, 0.405920, 0.394731, 0.366723, 0.309590, 0.212400,
        0.070771, 0.111187, 0.323663, 0.552803, 0.773520, 0.941189, -1.000000, 0.908827,
        0.666221, 0.317534, 0.056305, 0.358573, 0.510814, 0.500423, 0.389557, 0.259597,
        0.157470, 0.092276, 0.055554, 0.036233, 0.026392, 0.021482, 0.019088, 0.017945,
        0.017399, 0.017136, 0.017010, 0.016951, 0.016925, 0.016916,
    )

    private val LEARNED_DARK_VIOLET_KS_RESIDUAL_BASIS = doubleArrayOf(
        0.118242, 0.118381, 0.119034, 0.121471, 0.128976, 0.147590, 0.184919, 0.246590,
        0.332793, 0.439710, 0.565101, 0.706450, 0.848615, 0.958994, -1.000000, 0.947183,
        0.801896, 0.593511, 0.370620, 0.187843, 0.089574, 0.087708, 0.151869, 0.233125,
        0.298314, 0.339473, 0.362133, 0.373785, 0.379617, 0.382491, 0.383883, 0.384545,
        0.384860, 0.385012, 0.385085, 0.385119, 0.385134, 0.385139,
    )

    private val FIXED_CHROMATIC_BASES = arrayOf(BASE_C, BASE_M, BASE_Y, BASE_R, BASE_G, BASE_B)
    private val LEARNABLE_BASIS_RESIDUALS = arrayOf(
        BASIS_BLUE_REGION_RESIDUAL,
        BASIS_GREEN_REGION_RESIDUAL,
        BASIS_RED_REGION_RESIDUAL,
    )

    private data class BasisResidualLimits(
        val negative: Double,
        val positive: Double,
    )

    private val BASIS_DEFORMATION_LIMITS = Array(FIXED_CHROMATIC_BASES.size) { basisIndex ->
        Array(LEARNABLE_BASIS_RESIDUALS.size) { residualIndex ->
            basisResidualLimits(FIXED_CHROMATIC_BASES[basisIndex], LEARNABLE_BASIS_RESIDUALS[residualIndex])
        }
    }

    private var cachedChromaticBasisParams: MixingParameters? = null
    private var cachedChromaticBases: Array<DoubleArray>? = null

    // ── Public API ────────────────────────────────────────────────────────

    /**
     * Convert a Compose [Color] into the spectral mixing domain used by the
     * subtractive mixer. We reconstruct a reflectance curve, then convert it
     * into Kubelka-Munk K/S values, which mix linearly.
     */
    fun colorToMixSpace(color: Color): DoubleArray {
        val linearRgb = doubleArrayOf(
            srgbChannelToLinear(color.red.toDouble()),
            srgbChannelToLinear(color.green.toDouble()),
            srgbChannelToLinear(color.blue.toDouble()),
        )
        val pigment = estimatePigment(linearRgb)
        return DoubleArray(N) { index ->
            if (index < SPECTRAL_SAMPLES) pigment.absorption[index]
            else pigment.scattering[index - SPECTRAL_SAMPLES]
        }
    }

    internal fun colorToReflectance(color: Color): DoubleArray {
        val linearRgb = doubleArrayOf(
            srgbChannelToLinear(color.red.toDouble()),
            srgbChannelToLinear(color.green.toDouble()),
            srgbChannelToLinear(color.blue.toDouble()),
        )
        return reconstructReflectance(linearRgb)
    }

    internal fun colorComplementaryProfile(color: Color): ComplementaryMixProfile {
        val linearRgb = doubleArrayOf(
            srgbChannelToLinear(color.red.toDouble()),
            srgbChannelToLinear(color.green.toDouble()),
            srgbChannelToLinear(color.blue.toDouble()),
        )
        return complementaryMixProfile(linearRgb)
    }

    /** Convert mixed K/S values back to a Compose [Color]. */
    fun mixSpaceToColor(mixSpace: DoubleArray): Color {
        val reflectance = mixSpaceToReflectance(mixSpace)
        return reflectanceToColor(reflectance)
    }

    internal fun reflectanceToColor(reflectance: DoubleArray): Color {
        val xyz = reflectanceToXyz(reflectance)
        val linearRgb = multiply3x3Vector(XYZ_TO_SRGB_D65, xyz)
        return Color(
            red = linearChannelToSrgb(linearRgb[0].coerceIn(0.0, 1.0)).toFloat().coerceIn(0f, 1f),
            green = linearChannelToSrgb(linearRgb[1].coerceIn(0.0, 1.0)).toFloat().coerceIn(0f, 1f),
            blue = linearChannelToSrgb(linearRgb[2].coerceIn(0.0, 1.0)).toFloat().coerceIn(0f, 1f),
        )
    }

    internal fun reflectanceLuminance(reflectance: DoubleArray): Double =
        reflectanceToXyz(reflectance)[1].coerceIn(0.0, 1.0)

    internal fun mixPreparedToColor(
        mixSpaces: Array<DoubleArray>,
        reflectances: Array<DoubleArray>,
        darkChromaticWeights: DoubleArray,
        reflectanceLuminances: DoubleArray,
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
    ): Color? =
        mixPreparedReflectance(
            mixSpaces = mixSpaces,
            reflectances = reflectances,
            darkChromaticWeights = darkChromaticWeights,
            reflectanceLuminances = reflectanceLuminances,
            complementaryProfiles = complementaryProfiles,
            parts = parts,
        )?.let(::reflectanceToColor)

    internal fun mixPreparedReflectance(
        mixSpaces: Array<DoubleArray>,
        reflectances: Array<DoubleArray>,
        darkChromaticWeights: DoubleArray,
        reflectanceLuminances: DoubleArray,
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
    ): DoubleArray? {
        val activeIndices = parts.indices.filter { parts[it] > 0 }
        if (activeIndices.isEmpty()) return null
        if (activeIndices.size == 1) return reflectances[activeIndices.first()].copyOf()

        val spectralJsBlend = params.spectralJsKsMixBlend.coerceIn(0.0, 1.0)
        val customReflectance = if (spectralJsBlend >= 1.0 - EPSILON) null
        else mixPreparedCustomReflectance(mixSpaces, darkChromaticWeights, parts, activeIndices)
        val spectralJsReflectance = if (spectralJsBlend <= EPSILON) null
        else mixPreparedSpectralJsReflectance(reflectances, reflectanceLuminances, parts, activeIndices)

        val mixedReflectance = when {
            customReflectance == null -> spectralJsReflectance ?: reflectances[activeIndices.first()]
            spectralJsReflectance == null -> customReflectance
            else -> blendReflectance(customReflectance, spectralJsReflectance, spectralJsBlend)
        }

        val derivedResidualReflectance = applyDerivedResidualMixCorrection(
            reflectances = reflectances,
            darkChromaticWeights = darkChromaticWeights,
            complementaryProfiles = complementaryProfiles,
            parts = parts,
            activeIndices = activeIndices,
            mixedReflectance = mixedReflectance,
        )
        val derivedKsResidualReflectance = applyDerivedKsMixCorrection(
            darkChromaticWeights = darkChromaticWeights,
            complementaryProfiles = complementaryProfiles,
            parts = parts,
            activeIndices = activeIndices,
            mixedReflectance = derivedResidualReflectance,
        )

        val opponentBlend = params.opponentPairBasisBlend.coerceIn(0.0, 1.0)
        if (opponentBlend <= EPSILON) return derivedKsResidualReflectance

        val accent = buildOpponentPairAccentReflectance(
            reflectances = reflectances,
            reflectanceLuminances = reflectanceLuminances,
            complementaryProfiles = complementaryProfiles,
            parts = parts,
            activeIndices = activeIndices,
            mixedReflectance = derivedKsResidualReflectance,
        ) ?: return derivedKsResidualReflectance

        return blendReflectance(
            derivedKsResidualReflectance,
            accent.reflectance,
            opponentBlend * accent.stress,
        )
    }

    fun partToEffectiveConcentration(part: Int): Double =
        if (part <= 0) 0.0 else part.toDouble().pow(params.concentrationExponent)

    fun effectiveWeightToPartDomain(weight: Double): Double =
        weight.coerceAtLeast(0.0).pow(1.0 / params.concentrationExponent)

    internal fun colorDarkChromaticWeight(color: Color): Double {
        val linearRgb = doubleArrayOf(
            srgbChannelToLinear(color.red.toDouble()),
            srgbChannelToLinear(color.green.toDouble()),
            srgbChannelToLinear(color.blue.toDouble()),
        )
        return darkChromaticWeight(linearChroma(linearRgb), linearLuminance(linearRgb))
    }

    internal fun absorptionPowerMeanExponentForMix(
        colors: List<Color>,
        parts: List<Int>,
    ): Double {
        val darkChromaticWeights = DoubleArray(colors.size) { index ->
            colorDarkChromaticWeight(colors[index])
        }
        return absorptionPowerMeanExponentForMix(
            darkChromaticWeights = darkChromaticWeights,
            parts = IntArray(parts.size) { index -> parts[index] },
        )
    }

    internal fun darkChromaticMixStress(
        colors: List<Color>,
        parts: List<Int>,
    ): Double {
        val darkChromaticWeights = DoubleArray(colors.size) { index ->
            colorDarkChromaticWeight(colors[index])
        }
        return darkChromaticMixStress(
            darkChromaticWeights = darkChromaticWeights,
            parts = IntArray(parts.size) { index -> parts[index] },
        )
    }

    internal fun absorptionPowerMeanExponentForMix(
        darkChromaticWeights: DoubleArray,
        parts: IntArray,
    ): Double = absorptionPowerMeanExponentForStress(darkChromaticMixStress(darkChromaticWeights, parts))

    internal fun absorptionPowerMeanExponentForStress(mixStress: Double): Double {
        val baseExponent = params.absorptionPowerMeanExponent
        val targetExponent = minOf(baseExponent, params.darkChromaticAbsorptionPowerMeanExponent)
        if (targetExponent >= baseExponent) return baseExponent
        return lerp(baseExponent, targetExponent, mixStress)
    }

    internal fun darkChromaticScatteringEnvelopeBlendForMix(
        colors: List<Color>,
        parts: List<Int>,
    ): Double =
        darkChromaticScatteringEnvelopeBlendForStress(darkChromaticMixStress(colors, parts))

    internal fun darkChromaticScatteringEnvelopeBlendForMix(
        darkChromaticWeights: DoubleArray,
        parts: IntArray,
    ): Double =
        darkChromaticScatteringEnvelopeBlendForStress(darkChromaticMixStress(darkChromaticWeights, parts))

    internal fun darkChromaticScatteringEnvelopeBlendForStress(mixStress: Double): Double =
        (params.darkChromaticScatteringEnvelopeBlend * mixStress).coerceIn(0.0, 1.0)

    internal fun darkChromaticMixStress(
        darkChromaticWeights: DoubleArray,
        parts: IntArray,
    ): Double {
        val activeIndices = parts.indices.filter { parts[it] > 0 }
        if (activeIndices.size < 2) return 0.0

        val effectiveConcentrations = DoubleArray(activeIndices.size) { index ->
            partToEffectiveConcentration(parts[activeIndices[index]])
        }
        val totalEffectiveConcentration = effectiveConcentrations.sum()
        if (totalEffectiveConcentration <= EPSILON) return 0.0

        var mixStress = 0.0
        for (leftIndex in 0 until activeIndices.lastIndex) {
            val leftStress = darkChromaticWeights[activeIndices[leftIndex]].coerceIn(0.0, 1.0)
            if (leftStress <= 0.0) continue
            val leftWeight = effectiveConcentrations[leftIndex] / totalEffectiveConcentration

            for (rightIndex in leftIndex + 1 until activeIndices.size) {
                val rightStress = darkChromaticWeights[activeIndices[rightIndex]].coerceIn(0.0, 1.0)
                if (rightStress <= 0.0) continue

                val rightWeight = effectiveConcentrations[rightIndex] / totalEffectiveConcentration
                val pairBalance = sqrt((leftWeight * rightWeight / 0.25).coerceIn(0.0, 1.0))
                val pairStress = pairBalance * sqrt(leftStress * rightStress)
                if (pairStress > mixStress) mixStress = pairStress
            }
        }
        return mixStress
    }

    private data class OpponentPairAccent(
        val reflectance: DoubleArray,
        val stress: Double,
    )

    private fun buildOpponentPairAccentReflectance(
        reflectances: Array<DoubleArray>,
        reflectanceLuminances: DoubleArray,
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
        activeIndices: List<Int>,
        mixedReflectance: DoubleArray,
    ): OpponentPairAccent? {
        if (activeIndices.size < 2) return null

        val effectiveConcentrations = DoubleArray(activeIndices.size) { index ->
            partToEffectiveConcentration(parts[activeIndices[index]])
        }
        val totalEffectiveConcentration = effectiveConcentrations.sum()
        if (totalEffectiveConcentration <= EPSILON) return null

        val pairStress = opponentMixStress(complementaryProfiles, parts, activeIndices)
        var violetStress = pairStress.violet
        var greenStress = pairStress.green
        var weightedInputLuminance = 0.0

        for (index in activeIndices.indices) {
            weightedInputLuminance +=
                (effectiveConcentrations[index] / totalEffectiveConcentration) *
                reflectanceLuminances[activeIndices[index]]
        }

        val combinedStress = maxOf(violetStress, greenStress)
        if (combinedStress <= EPSILON) return null

        val totalStress = violetStress + greenStress
        val violetWeight = if (totalStress <= EPSILON) 0.0 else violetStress / totalStress
        val greenWeight = if (totalStress <= EPSILON) 0.0 else greenStress / totalStress

        val baseLuminance = reflectanceLuminance(mixedReflectance)
        val targetLuminance = lerp(
            baseLuminance,
            maxOf(baseLuminance, weightedInputLuminance),
            params.opponentPairBasisLuminanceLift * combinedStress,
        )

        val magentaBasis = luminanceMatchedBasisReflectance(BASE_M, BASE_MAGENTA_LUMINANCE, targetLuminance)
        val greenBasis = luminanceMatchedBasisReflectance(BASE_G, BASE_GREEN_LUMINANCE, targetLuminance)
        val accentReflectance = when {
            violetWeight <= EPSILON -> greenBasis
            greenWeight <= EPSILON -> magentaBasis
            else -> DoubleArray(SPECTRAL_SAMPLES) { index ->
                lerp(magentaBasis[index], greenBasis[index], greenWeight).coerceIn(EPSILON, 1.0)
            }
        }

        return OpponentPairAccent(accentReflectance, combinedStress)
    }

    internal fun opponentMixStress(
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
    ): OpponentMixStress {
        val activeIndices = parts.indices.filter { parts[it] > 0 }
        return opponentMixStress(complementaryProfiles, parts, activeIndices)
    }

    private fun opponentMixStress(
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
        activeIndices: List<Int>,
    ): OpponentMixStress {
        if (activeIndices.size < 2) return OpponentMixStress(0.0, 0.0)

        val effectiveConcentrations = DoubleArray(activeIndices.size) { index ->
            partToEffectiveConcentration(parts[activeIndices[index]])
        }
        val totalEffectiveConcentration = effectiveConcentrations.sum()
        if (totalEffectiveConcentration <= EPSILON) return OpponentMixStress(0.0, 0.0)

        var violetStress = 0.0
        var greenStress = 0.0

        for (leftIndex in 0 until activeIndices.lastIndex) {
            val leftProfile = complementaryProfiles[activeIndices[leftIndex]]
            if (leftProfile.chroma <= 0.0) continue
            val leftWeight = effectiveConcentrations[leftIndex] / totalEffectiveConcentration

            for (rightIndex in leftIndex + 1 until activeIndices.size) {
                val rightProfile = complementaryProfiles[activeIndices[rightIndex]]
                if (rightProfile.chroma <= 0.0) continue

                val rightWeight = effectiveConcentrations[rightIndex] / totalEffectiveConcentration
                val pairBalance = sqrt((leftWeight * rightWeight / 0.25).coerceIn(0.0, 1.0))
                val chromaStress = sqrt(leftProfile.chroma * rightProfile.chroma).coerceIn(0.0, 1.0)

                val violetPair = maxOf(
                    leftProfile.redScore * rightProfile.blueScore,
                    leftProfile.blueScore * rightProfile.redScore,
                )
                val greenPair = maxOf(
                    leftProfile.blueScore * rightProfile.yellowScore,
                    leftProfile.yellowScore * rightProfile.blueScore,
                )

                violetStress = maxOf(violetStress, pairBalance * chromaStress * violetPair)
                greenStress = maxOf(greenStress, pairBalance * chromaStress * greenPair)
            }
        }
        return OpponentMixStress(violetStress, greenStress)
    }

    private fun mixPreparedCustomReflectance(
        mixSpaces: Array<DoubleArray>,
        darkChromaticWeights: DoubleArray,
        parts: IntArray,
        activeIndices: List<Int>,
    ): DoubleArray {
        val mixedMixSpace = DoubleArray(N)
        val halfN = SPECTRAL_SAMPLES
        val maxScatteringEnvelope = DoubleArray(halfN)
        val totalEffectiveConcentration = activeIndices.sumOf {
            partToEffectiveConcentration(parts[it])
        }
        val mixStress = darkChromaticMixStress(darkChromaticWeights, parts)
        val p = absorptionPowerMeanExponentForStress(mixStress)
        val scatteringEnvelopeBlend = darkChromaticScatteringEnvelopeBlendForStress(mixStress)
        val invP = 1.0 / p

        for (index in activeIndices) {
            val weight = partToEffectiveConcentration(parts[index]) / totalEffectiveConcentration
            val mixSpace = mixSpaces[index]

            for (lam in 0 until halfN) {
                mixedMixSpace[lam] += weight * (mixSpace[lam] + SpectralBaseMixEngine.EPSILON).pow(p)
            }
            for (lam in halfN until N) {
                val scattering = mixSpace[lam]
                mixedMixSpace[lam] += weight * scattering
                val scatteringIndex = lam - halfN
                if (scattering > maxScatteringEnvelope[scatteringIndex]) {
                    maxScatteringEnvelope[scatteringIndex] = scattering
                }
            }
        }

        for (lam in 0 until halfN) {
            mixedMixSpace[lam] = mixedMixSpace[lam].coerceAtLeast(0.0).pow(invP)
        }
        if (scatteringEnvelopeBlend > 0.0) {
            for (lam in halfN until N) {
                val scatteringIndex = lam - halfN
                val current = mixedMixSpace[lam]
                val envelope = maxScatteringEnvelope[scatteringIndex]
                mixedMixSpace[lam] = current + (envelope - current) * scatteringEnvelopeBlend
            }
        }
        return mixSpaceToReflectance(mixedMixSpace)
    }

    private fun mixPreparedSpectralJsReflectance(
        reflectances: Array<DoubleArray>,
        reflectanceLuminances: DoubleArray,
        parts: IntArray,
        activeIndices: List<Int>,
    ): DoubleArray {
        val mixedKs = DoubleArray(SPECTRAL_SAMPLES)
        var totalConcentration = 0.0

        for (index in activeIndices) {
            val factor = parts[index].toDouble()
            val concentration = factor * factor * reflectanceLuminances[index].coerceAtLeast(EPSILON)
            totalConcentration += concentration

            val reflectance = reflectances[index]
            for (lam in 0 until SPECTRAL_SAMPLES) {
                mixedKs[lam] += reflectanceToKs(reflectance[lam]) * concentration
            }
        }

        if (totalConcentration <= EPSILON) return reflectances[activeIndices.first()].copyOf()

        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            ksToReflectance((mixedKs[index] / totalConcentration).coerceAtLeast(0.0))
        }
    }

    private fun applyDerivedResidualMixCorrection(
        reflectances: Array<DoubleArray>,
        darkChromaticWeights: DoubleArray,
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
        activeIndices: List<Int>,
        mixedReflectance: DoubleArray,
    ): DoubleArray {
        val violetScale = params.derivedVioletMixResidualScale
        val greenScale = params.derivedGreenMixResidualScale
        val darkVioletScale = params.derivedDarkVioletMixResidualScale
        if (violetScale <= EPSILON && greenScale <= EPSILON && darkVioletScale <= EPSILON) {
            return mixedReflectance
        }

        val opponentStress = opponentMixStress(complementaryProfiles, parts, activeIndices)
        val darkStress = darkChromaticMixStress(darkChromaticWeights, parts)
        val violetStress = opponentStress.violet
        val greenStress = opponentStress.green
        val darkVioletStress = sqrt((violetStress * darkStress).coerceIn(0.0, 1.0))
        if (violetStress <= EPSILON && greenStress <= EPSILON && darkVioletStress <= EPSILON) {
            return mixedReflectance
        }

        val logResidual = DoubleArray(SPECTRAL_SAMPLES) { index ->
            violetScale * violetStress * LEARNED_VIOLET_MIX_RESIDUAL_BASIS[index] +
                greenScale * greenStress * LEARNED_GREEN_MIX_RESIDUAL_BASIS[index] +
                darkVioletScale * darkVioletStress * LEARNED_DARK_VIOLET_MIX_RESIDUAL_BASIS[index]
        }
        return applyBoundedLogReflectanceResidual(mixedReflectance, logResidual)
    }

    private fun applyDerivedKsMixCorrection(
        darkChromaticWeights: DoubleArray,
        complementaryProfiles: Array<ComplementaryMixProfile>,
        parts: IntArray,
        activeIndices: List<Int>,
        mixedReflectance: DoubleArray,
    ): DoubleArray {
        val violetScale = params.derivedVioletKsResidualScale
        val darkVioletScale = params.derivedDarkVioletKsResidualScale
        if (violetScale <= EPSILON && darkVioletScale <= EPSILON) return mixedReflectance

        val opponentStress = opponentMixStress(complementaryProfiles, parts, activeIndices)
        val darkStress = darkChromaticMixStress(darkChromaticWeights, parts)
        val violetStress = opponentStress.violet
        val darkVioletStress = sqrt((violetStress * darkStress).coerceIn(0.0, 1.0))
        if (violetStress <= EPSILON && darkVioletStress <= EPSILON) return mixedReflectance

        val ksResidual = DoubleArray(SPECTRAL_SAMPLES) { index ->
            violetScale * violetStress * LEARNED_VIOLET_KS_RESIDUAL_BASIS[index] +
                darkVioletScale * darkVioletStress * LEARNED_DARK_VIOLET_KS_RESIDUAL_BASIS[index]
        }
        return applyBoundedKsResidual(mixedReflectance, ksResidual)
    }

    private fun luminanceMatchedBasisReflectance(
        basisReflectance: DoubleArray,
        basisLuminance: Double,
        targetLuminance: Double,
    ): DoubleArray {
        val scale = (targetLuminance.coerceAtLeast(EPSILON) / basisLuminance.coerceAtLeast(EPSILON))
        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            (basisReflectance[index] * scale).coerceIn(EPSILON, 1.0)
        }
    }

    // ── Pigment estimation ────────────────────────────────────────────────

    private fun estimatePigment(linearRgb: DoubleArray): PigmentEstimate {
        val rgb = DoubleArray(3) { linearRgb[it].coerceIn(0.0, 1.0) }

        val reflectance = reconstructReflectance(rgb)
        val scattering = estimateScatteringCurve(rgb, reflectance)
        val strength = estimatePigmentStrength(rgb)

        val luminance = linearLuminance(rgb)
        val chroma = linearChroma(rgb)
        val p = params
        val darkChromaticScore = darkChromaticWeight(chroma, luminance)

        // Standard absorption boost for mid-to-bright chromatic colours
        val luminanceFactor = if (luminance > p.absorptionBoostLuminanceThreshold) sqrt(luminance)
        else p.absorptionBoostLuminanceFloor + (1.0 - p.absorptionBoostLuminanceFloor) * luminance / p.absorptionBoostLuminanceThreshold
        val standardBoost = p.absorptionBoostFactor * chroma * luminanceFactor

        // Reuse the same dark-chromatic stress score that drives the dual
        // sigmoid override so extremely dark saturated pigments keep stronger
        // absorption structure in K/S space instead of collapsing toward black.
        val darkChromaFactor = p.darkAbsorptionBoostFactor * chroma * darkChromaticScore

        val absorptionBoost = 1.0 + standardBoost + darkChromaFactor

        return PigmentEstimate(
            absorption = DoubleArray(SPECTRAL_SAMPLES) { index ->
                reflectanceToKs(reflectance[index]) * scattering[index] * strength * absorptionBoost
            },
            scattering = DoubleArray(SPECTRAL_SAMPLES) { index ->
                scattering[index] * strength
            },
        )
    }

    /**
     * Reconstruct a spectral reflectance curve from linear RGB.
     *
     * Neutrals get a flat curve.  Chromatic colours are fitted with a dual
     * sigmoid model.
     */
    private fun reconstructReflectance(rgb: DoubleArray): DoubleArray {
        if (isNeutral(rgb)) {
            val value = ((rgb[0] + rgb[1] + rgb[2]) / 3.0).coerceIn(EPSILON, 1.0)
            return DoubleArray(SPECTRAL_SAMPLES) { value }
        }

        val basisReflectance = reconstructBasisReflectance(rgb)
        val basisBlend = params.spectralBasisReflectanceBlend.coerceIn(0.0, 1.0)
        if (basisBlend >= 1.0 - EPSILON) return basisReflectance

        val targetXyz = multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)
        val legacyReflectance = fitDualSigmoidReflectance(targetXyz, rgb)
        if (basisBlend <= EPSILON) return legacyReflectance
        return blendReflectance(legacyReflectance, basisReflectance, basisBlend)
    }

    private fun reconstructBasisReflectance(rgb: DoubleArray): DoubleArray {
        val chromaticBases = currentChromaticBases()
        val white = minOf(rgb[0], rgb[1], rgb[2])
        val shifted = doubleArrayOf(
            rgb[0] - white,
            rgb[1] - white,
            rgb[2] - white,
        )

        val cyan = minOf(shifted[1], shifted[2])
        val magenta = minOf(shifted[0], shifted[2])
        val yellow = minOf(shifted[0], shifted[1])
        val red = maxOf(0.0, minOf(shifted[0] - shifted[2], shifted[0] - shifted[1]))
        val green = maxOf(0.0, minOf(shifted[1] - shifted[2], shifted[1] - shifted[0]))
        val blue = maxOf(0.0, minOf(shifted[2] - shifted[1], shifted[2] - shifted[0]))

        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            maxOf(
                EPSILON,
                white * BASE_W[index] +
                    cyan * chromaticBases[0][index] +
                    magenta * chromaticBases[1][index] +
                    yellow * chromaticBases[2][index] +
                    red * chromaticBases[3][index] +
                    green * chromaticBases[4][index] +
                    blue * chromaticBases[5][index],
            )
        }
    }

    private fun currentChromaticBases(): Array<DoubleArray> {
        val cachedParams = cachedChromaticBasisParams
        val cachedBases = cachedChromaticBases
        if (cachedParams == params && cachedBases != null) return cachedBases

        val controls = basisResidualControls(params)
        val deformedBases = Array(FIXED_CHROMATIC_BASES.size) { basisIndex ->
            deformChromaticBasis(
                base = FIXED_CHROMATIC_BASES[basisIndex],
                control = controls[basisIndex],
                limits = BASIS_DEFORMATION_LIMITS[basisIndex],
            )
        }
        cachedChromaticBasisParams = params
        cachedChromaticBases = deformedBases
        return deformedBases
    }

    private fun basisResidualControls(parameters: MixingParameters): Array<DoubleArray> = arrayOf(
        doubleArrayOf(parameters.basisCBlueResidual, parameters.basisCGreenResidual, parameters.basisCRedResidual),
        doubleArrayOf(parameters.basisMBlueResidual, parameters.basisMGreenResidual, parameters.basisMRedResidual),
        doubleArrayOf(parameters.basisYBlueResidual, parameters.basisYGreenResidual, parameters.basisYRedResidual),
        doubleArrayOf(parameters.basisRBlueResidual, parameters.basisRGreenResidual, parameters.basisRRedResidual),
        doubleArrayOf(parameters.basisGBlueResidual, parameters.basisGGreenResidual, parameters.basisGRedResidual),
        doubleArrayOf(parameters.basisBBlueResidual, parameters.basisBGreenResidual, parameters.basisBRedResidual),
    )

    private fun deformChromaticBasis(
        base: DoubleArray,
        control: DoubleArray,
        limits: Array<BasisResidualLimits>,
    ): DoubleArray {
        val scaledCoefficients = DoubleArray(control.size) { index ->
            scaledBasisResidualCoefficient(control[index], limits[index])
        }
        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            var value = base[index]
            for (residualIndex in scaledCoefficients.indices) {
                value += scaledCoefficients[residualIndex] * LEARNABLE_BASIS_RESIDUALS[residualIndex][index]
            }
            value.coerceIn(EPSILON, 1.0)
        }
    }

    private fun applyBoundedLogReflectanceResidual(
        baseReflectance: DoubleArray,
        logResidual: DoubleArray,
    ): DoubleArray {
        val minLogReflectance = ln(EPSILON)
        var boundedScale = 1.0
        for (index in logResidual.indices) {
            val delta = logResidual[index]
            if (abs(delta) <= EPSILON) continue

            val baseLog = ln(baseReflectance[index].coerceIn(EPSILON, 1.0))
            val limit = if (delta > 0.0) {
                (0.0 - baseLog) / delta
            } else {
                (minLogReflectance - baseLog) / delta
            }
            boundedScale = minOf(boundedScale, limit.coerceAtLeast(0.0))
        }
        if (boundedScale <= EPSILON) return baseReflectance

        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            exp(
                ln(baseReflectance[index].coerceIn(EPSILON, 1.0)) +
                    boundedScale * logResidual[index]
            ).coerceIn(EPSILON, 1.0 - EPSILON)
        }
    }

    private fun applyBoundedKsResidual(
        baseReflectance: DoubleArray,
        ksResidual: DoubleArray,
    ): DoubleArray {
        val baseKs = DoubleArray(SPECTRAL_SAMPLES) { index ->
            reflectanceToKs(baseReflectance[index])
        }
        var boundedScale = 1.0
        for (index in ksResidual.indices) {
            val delta = ksResidual[index]
            if (delta >= -EPSILON) continue
            boundedScale = minOf(boundedScale, (baseKs[index] / -delta).coerceAtLeast(0.0))
        }
        if (boundedScale <= EPSILON) return baseReflectance

        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            ksToReflectance((baseKs[index] + boundedScale * ksResidual[index]).coerceAtLeast(0.0))
        }
    }

    // ── Dual sigmoid fitting ──────────────────────────────────────────────

    /**
     * Fit a dual sigmoid reflectance model:
     *
     *     R(λ) = α·σ(a₀ + a₁·t + a₂·t²) + (1−α)·σ(b₀ + b₁·t + b₂·t²)
     *
     * **Phase 1**: Fit a single quadratic sigmoid (a₀, a₁, a₂) with Gauss-Newton.
     * This handles all single-transition colours (red, yellow, blue, green).
     *
     * **Phase 2**: If the single-sigmoid residual is above a threshold, introduce
     * a second lobe.  The 7 parameters (α, a₀–a₂, b₀–b₂) are fitted jointly
     * with a regularisation term pulling α→1 (single-sigmoid preference).
     */
    private fun fitDualSigmoidReflectance(targetXyz: DoubleArray, rgb: DoubleArray): DoubleArray {
        // Phase 1: single quadratic sigmoid
        val (a0, a1, a2, singleErr) = fitSingleSigmoid(targetXyz)

        val luminance = linearLuminance(rgb)
        val chroma = linearChroma(rgb)
        val darkChromaticScore = darkChromaticWeight(chroma, luminance)

        // Dark saturated colours (crimson, phthalo blue, etc.) can have tiny
        // XYZ residuals while still producing spectrally wrong, overly absorptive
        // curves. Only non-stress colours are allowed to skip phase 2.
        if (singleErr < params.dualSigmoidSkipResidualThreshold && darkChromaticScore <= 0.0) {
            return evalSigmoid(a0, a1, a2)
        }

        // Phase 2: try dual sigmoid for double-peaked / complex spectra
        val (refDual, dualErr) = fitDualSigmoid(targetXyz, rgb, a0, a1, a2, darkChromaticScore)

        val improvementThreshold = lerp(
            params.dualSigmoidImprovementRatio,
            params.darkChromaticDualSigmoidImprovementRatio,
            darkChromaticScore,
        )
        val baseReflectance = if (dualErr < singleErr * improvementThreshold) refDual
        else evalSigmoid(a0, a1, a2)
        return applyDarkChromaticResidualBasis(baseReflectance, rgb, darkChromaticScore)
    }

    /** Evaluate a single quadratic sigmoid at all wavelengths. */
    private fun evalSigmoid(c0: Double, c1: Double, c2: Double): DoubleArray =
        DoubleArray(SPECTRAL_SAMPLES) { i ->
            val t = WAVELENGTH_T[i]
            sigmoid(c0 + c1 * t + c2 * t * t).coerceIn(EPSILON, 1.0 - EPSILON)
        }

    /** Evaluate a dual sigmoid at all wavelengths. */
    private fun evalDualSigmoid(
        alpha: Double, a0: Double, a1: Double, a2: Double,
        b0: Double, b1: Double, b2: Double,
    ): DoubleArray =
        DoubleArray(SPECTRAL_SAMPLES) { i ->
            val t = WAVELENGTH_T[i]
            val sa = sigmoid(a0 + a1 * t + a2 * t * t)
            val sb = sigmoid(b0 + b1 * t + b2 * t * t)
            (alpha * sa + (1.0 - alpha) * sb).coerceIn(EPSILON, 1.0 - EPSILON)
        }

    private fun applyDarkChromaticResidualBasis(
        baseReflectance: DoubleArray,
        rgb: DoubleArray,
        darkChromaticScore: Double,
    ): DoubleArray {
        val scale = params.darkChromaticResidualBasisScale * darkChromaticScore
        if (scale <= 0.0) return baseReflectance

        val maxChannel = maxOf(rgb[0], rgb[1], rgb[2]).coerceAtLeast(EPSILON)
        val red = rgb[0] / maxChannel
        val green = rgb[1] / maxChannel
        val blue = rgb[2] / maxChannel

        val redDominance = (red - 0.5 * (green + blue)).coerceIn(0.0, 1.0)
        val blueDominance = (blue - 0.5 * (red + green)).coerceIn(0.0, 1.0)
        val magentaDominance = (0.5 * (red + blue) - green).coerceIn(0.0, 1.0)
        if (redDominance <= 0.0 && blueDominance <= 0.0 && magentaDominance <= 0.0) {
            return baseReflectance
        }

        val residual = DoubleArray(SPECTRAL_SAMPLES) { index ->
            scale * (
                redDominance * RED_RESIDUAL_BASIS[index] +
                    blueDominance * BLUE_RESIDUAL_BASIS[index] +
                    0.6 * magentaDominance * MAGENTA_RESIDUAL_BASIS[index]
                )
        }

        var boundedScale = 1.0
        for (index in residual.indices) {
            val delta = residual[index]
            if (delta > 0.0) {
                boundedScale = minOf(boundedScale, (1.0 - EPSILON - baseReflectance[index]) / delta)
            } else if (delta < 0.0) {
                boundedScale = minOf(boundedScale, (baseReflectance[index] - EPSILON) / -delta)
            }
        }
        if (boundedScale <= EPSILON) return baseReflectance

        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            (baseReflectance[index] + boundedScale * residual[index]).coerceIn(EPSILON, 1.0 - EPSILON)
        }
    }

    private fun blendReflectance(
        legacyReflectance: DoubleArray,
        basisReflectance: DoubleArray,
        blend: Double,
    ): DoubleArray {
        val t = blend.coerceIn(0.0, 1.0)
        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            lerp(legacyReflectance[index], basisReflectance[index], t).coerceIn(EPSILON, 1.0 - EPSILON)
        }
    }

    /**
     * Phase 1: Fit (c₀, c₁, c₂) for R(λ) = σ(c₀ + c₁t + c₂t²).
     * Returns (c0, c1, c2, residualError).
     */
    private data class SingleResult(val c0: Double, val c1: Double, val c2: Double, val err: Double)

    private fun fitSingleSigmoid(targetXyz: DoubleArray): SingleResult {
        val luminance = targetXyz[1].coerceIn(0.001, 0.999)
        val rgb = multiply3x3Vector(XYZ_TO_SRGB_D65, targetXyz)
        val maxC = maxOf(rgb[0], rgb[1], rgb[2]).coerceAtLeast(0.01)

        val c1Init = 12.0 * (rgb[0] - rgb[2]) / maxC
        val c2Init = -16.0 * (rgb[1] - 0.5 * (rgb[0] + rgb[2])) / maxC
        val c0Init = logit(luminance) - c1Init * 0.5 - c2Init * 0.25

        var c0 = c0Init
        var c1 = c1Init
        var c2 = c2Init
        var lastErr = Double.MAX_VALUE

        for (iter in 0 until MAX_ITERATIONS) {
            val reflectance = DoubleArray(SPECTRAL_SAMPLES)
            val dSigmoid = DoubleArray(SPECTRAL_SAMPLES)
            for (i in 0 until SPECTRAL_SAMPLES) {
                val t = WAVELENGTH_T[i]
                val s = sigmoid(c0 + c1 * t + c2 * t * t)
                reflectance[i] = s
                dSigmoid[i] = s * (1.0 - s)
            }

            val xyz = reflectanceToXyz(reflectance)
            val rx = xyz[0] - targetXyz[0]
            val ry = xyz[1] - targetXyz[1]
            val rz = xyz[2] - targetXyz[2]
            val err = rx * rx + ry * ry + rz * rz
            if (err < 1e-12) return SingleResult(c0, c1, c2, err)

            // 3×3 Jacobian
            val j = Array(3) { DoubleArray(3) }
            for (i in 0 until SPECTRAL_SAMPLES) {
                val t = WAVELENGTH_T[i]
                val d = dSigmoid[i]
                val d0 = d; val d1 = d * t; val d2 = d * t * t
                j[0][0] += X_BAR[i] * d0; j[0][1] += X_BAR[i] * d1; j[0][2] += X_BAR[i] * d2
                j[1][0] += Y_BAR[i] * d0; j[1][1] += Y_BAR[i] * d1; j[1][2] += Y_BAR[i] * d2
                j[2][0] += Z_BAR[i] * d0; j[2][1] += Z_BAR[i] * d1; j[2][2] += Z_BAR[i] * d2
            }

            val delta = solve3x3(j, doubleArrayOf(-rx, -ry, -rz)) ?: break

            // Damped line search
            var step = 1.0
            for (ls in 0 until 5) {
                val nc0 = c0 + step * delta[0]
                val nc1 = c1 + step * delta[1]
                val nc2 = c2 + step * delta[2]
                val nRef = DoubleArray(SPECTRAL_SAMPLES) { i ->
                    val t = WAVELENGTH_T[i]
                    sigmoid(nc0 + nc1 * t + nc2 * t * t)
                }
                val nXyz = reflectanceToXyz(nRef)
                val newErr = sqr(nXyz[0] - targetXyz[0]) + sqr(nXyz[1] - targetXyz[1]) + sqr(nXyz[2] - targetXyz[2])
                if (newErr < err) {
                    c0 = nc0; c1 = nc1; c2 = nc2; lastErr = newErr
                    break
                }
                step *= 0.5
            }
        }

        return SingleResult(c0, c1, c2, lastErr)
    }

    /**
     * Phase 2: Fit dual sigmoid jointly.
     *
     * Parameters: α ∈ (0,1), a₀, a₁, a₂ (lobe A), b₀, b₁, b₂ (lobe B).
     * We optimise in logit-α space so α stays in (0,1) naturally.
     *
     * The second lobe is initialised with the opposite spectral slope of the
     * first, targeting the complementary spectral region.
     */
    private fun fitDualSigmoid(
        targetXyz: DoubleArray,
        rgb: DoubleArray,
        a0Init: Double,
        a1Init: Double,
        a2Init: Double,
        darkChromaticScore: Double,
    ): Pair<DoubleArray, Double> {
        val luminance = targetXyz[1].coerceIn(0.001, 0.999)
        val dominantChannel = maxOf(rgb[0], rgb[1], rgb[2]).coerceIn(0.02, 0.98)

        // Dark chromatic colours need a more assertive second lobe seed: lift the
        // secondary lobe's brightness toward the dominant channel and mirror the
        // slope/curvature more strongly so phase 2 explores a genuinely different
        // spectral shape instead of a near-duplicate of the single fit.
        val secondaryLobeLuminance = lerp(luminance, 0.5 * (luminance + dominantChannel), darkChromaticScore)
            .coerceIn(0.001, 0.999)
        val b0Init = logit(secondaryLobeLuminance)
        val slopeScale = lerp(0.5, 0.9, darkChromaticScore)
        val curvatureScale = lerp(0.3, 0.6, darkChromaticScore)
        val b1Init = -a1Init * slopeScale
        val b2Init = -a2Init * curvatureScale

        var alpha = lerp(0.8, 0.6, darkChromaticScore)
        var a0 = a0Init; var a1 = a1Init; var a2 = a2Init
        var b0 = b0Init; var b1 = b1Init; var b2 = b2Init

        val reg = params.dualSigmoidRegularisation *
            lerp(1.0, params.darkChromaticRegularisationScale, darkChromaticScore)
        var lastErr = Double.MAX_VALUE

        for (iter in 0 until MAX_ITERATIONS) {
            val reflectance = evalDualSigmoid(alpha, a0, a1, a2, b0, b1, b2)
            val xyz = reflectanceToXyz(reflectance)
            val rx = xyz[0] - targetXyz[0]
            val ry = xyz[1] - targetXyz[1]
            val rz = xyz[2] - targetXyz[2]
            // Regularisation: pull α toward 1 (prefer single sigmoid)
            val rAlpha = reg * (alpha - 1.0)
            val err = rx * rx + ry * ry + rz * rz + rAlpha * rAlpha
            if (err < 1e-12) break
            lastErr = err

            // Build 7×7 Jacobian: 3 XYZ rows + 1 regularisation row on α
            // Parameters: [α, a0, a1, a2, b0, b1, b2]
            val nParams = 7
            val nResiduals = 4
            val j = Array(nResiduals) { DoubleArray(nParams) }
            val residuals = doubleArrayOf(rx, ry, rz, rAlpha)

            for (i in 0 until SPECTRAL_SAMPLES) {
                val t = WAVELENGTH_T[i]
                val xA = a0 + a1 * t + a2 * t * t
                val xB = b0 + b1 * t + b2 * t * t
                val sA = sigmoid(xA)
                val sB = sigmoid(xB)
                val dsA = sA * (1.0 - sA)
                val dsB = sB * (1.0 - sB)

                // ∂R/∂α = sA - sB
                val dRdAlpha = sA - sB
                // ∂R/∂a0 = α·dsA, ∂R/∂a1 = α·dsA·t, ∂R/∂a2 = α·dsA·t²
                val dRda0 = alpha * dsA
                val dRda1 = alpha * dsA * t
                val dRda2 = alpha * dsA * t * t
                // ∂R/∂b0 = (1-α)·dsB, etc.
                val beta = 1.0 - alpha
                val dRdb0 = beta * dsB
                val dRdb1 = beta * dsB * t
                val dRdb2 = beta * dsB * t * t

                // Accumulate into XYZ Jacobian rows
                val bars = arrayOf(X_BAR, Y_BAR, Z_BAR)
                for (row in 0 until 3) {
                    val w = bars[row][i]
                    j[row][0] += w * dRdAlpha
                    j[row][1] += w * dRda0
                    j[row][2] += w * dRda1
                    j[row][3] += w * dRda2
                    j[row][4] += w * dRdb0
                    j[row][5] += w * dRdb1
                    j[row][6] += w * dRdb2
                }
            }
            // Regularisation row: ∂rAlpha/∂α = reg, others zero
            j[3][0] = reg

            // Solve via normal equations: (JᵀJ)·δ = -Jᵀr
            val jtj = Array(nParams) { DoubleArray(nParams) }
            val jtr = DoubleArray(nParams)
            for (row in 0 until nResiduals) {
                for (p in 0 until nParams) {
                    jtr[p] += j[row][p] * residuals[row]
                    for (q in p until nParams) {
                        jtj[p][q] += j[row][p] * j[row][q]
                    }
                }
            }
            // Symmetrise + Levenberg-Marquardt damping
            for (p in 0 until nParams) {
                for (q in 0 until p) jtj[p][q] = jtj[q][p]
                jtj[p][p] *= 1.001  // slight damping for stability
                jtj[p][p] += 1e-8
            }

            val delta = solveNxN(jtj, DoubleArray(nParams) { -jtr[it] }) ?: break

            // Damped line search
            var step = 1.0
            for (ls in 0 until 6) {
                val nAlpha = (alpha + step * delta[0]).coerceIn(0.05, 0.99)
                val na0 = a0 + step * delta[1]
                val na1 = a1 + step * delta[2]
                val na2 = a2 + step * delta[3]
                val nb0 = b0 + step * delta[4]
                val nb1 = b1 + step * delta[5]
                val nb2 = b2 + step * delta[6]

                val nRef = evalDualSigmoid(nAlpha, na0, na1, na2, nb0, nb1, nb2)
                val nXyz = reflectanceToXyz(nRef)
                val nrAlpha = reg * (nAlpha - 1.0)
                val newErr = sqr(nXyz[0] - targetXyz[0]) + sqr(nXyz[1] - targetXyz[1]) +
                    sqr(nXyz[2] - targetXyz[2]) + nrAlpha * nrAlpha

                if (newErr < err) {
                    alpha = nAlpha; a0 = na0; a1 = na1; a2 = na2
                    b0 = nb0; b1 = nb1; b2 = nb2; lastErr = newErr
                    break
                }
                step *= 0.5
            }
        }

        val finalRef = evalDualSigmoid(alpha, a0, a1, a2, b0, b1, b2)
        val finalXyz = reflectanceToXyz(finalRef)
        val finalErr = sqr(finalXyz[0] - targetXyz[0]) + sqr(finalXyz[1] - targetXyz[1]) +
            sqr(finalXyz[2] - targetXyz[2])
        return finalRef to finalErr
    }

    // ── Scattering & pigment strength (unchanged) ─────────────────────────

    private fun estimateScatteringCurve(
        rgb: DoubleArray,
        reflectance: DoubleArray,
    ): DoubleArray {
        val luminance = multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)[1].coerceIn(0.0, 1.0)
        val chroma = linearChroma(rgb)
        val neutrality = (1.0 - chroma).coerceIn(0.0, 1.0)
        val p = params

        val chromaticBoost = p.scatteringChromaticMultiplier * chroma *
            (p.scatteringChromaticLuminanceFloor + (1.0 - p.scatteringChromaticLuminanceFloor) * sqrt(luminance))

        val scatteringStrength = (
            p.scatteringMin +
                p.scatteringBaseLuminanceScale * sqrt(luminance) +
                p.scatteringNeutralLuminanceScale * neutrality * luminance * luminance +
                chromaticBoost
            ).coerceIn(p.scatteringMin, p.scatteringMax)

        val shapeBase = p.scatteringShapeBase + p.scatteringShapeChromaScale * chroma

        return DoubleArray(SPECTRAL_SAMPLES) { index ->
            val shape = shapeBase + (1.0 - shapeBase) * sqrt(reflectance[index].coerceIn(EPSILON, 1.0))
            scatteringStrength * shape
        }
    }

    private fun estimatePigmentStrength(rgb: DoubleArray): Double {
        val luminance = multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)[1].coerceIn(0.0, 1.0)
        val chroma = linearChroma(rgb)
        val neutrality = (1.0 - chroma).coerceIn(0.0, 1.0)
        val p = params
        return (
            p.pigmentStrengthBase +
                p.pigmentStrengthLuminanceScale * luminance +
                p.pigmentStrengthNeutralityScale * neutrality
            ).coerceIn(p.pigmentStrengthMin, p.pigmentStrengthMax)
    }

    // ── K/S conversion ────────────────────────────────────────────────────

    private fun mixSpaceToReflectance(mixSpace: DoubleArray): DoubleArray =
        DoubleArray(SPECTRAL_SAMPLES) { index ->
            val absorption = mixSpace[index].coerceAtLeast(0.0)
            val scattering = mixSpace[index + SPECTRAL_SAMPLES].coerceAtLeast(EPSILON)
            val ks = absorption / scattering
            ksToReflectance(ks)
        }

    private fun reflectanceToXyz(reflectance: DoubleArray): DoubleArray =
        doubleArrayOf(
            spectralDot(reflectance, X_BAR),
            spectralDot(reflectance, Y_BAR),
            spectralDot(reflectance, Z_BAR),
        )

    private fun spectralDot(left: DoubleArray, right: DoubleArray): Double {
        var sum = 0.0
        for (i in left.indices) sum += left[i] * right[i]
        return sum
    }

    private fun basisResidualLimits(
        base: DoubleArray,
        residual: DoubleArray,
    ): BasisResidualLimits {
        var positiveLimit = Double.POSITIVE_INFINITY
        var negativeLimit = Double.POSITIVE_INFINITY

        for (index in base.indices) {
            val residualValue = residual[index]
            if (residualValue > EPSILON) {
                positiveLimit = minOf(positiveLimit, (1.0 - base[index]) / residualValue)
            } else if (residualValue < -EPSILON) {
                negativeLimit = minOf(negativeLimit, (base[index] - EPSILON) / -residualValue)
            }
        }

        if (!positiveLimit.isFinite()) positiveLimit = 0.0
        if (!negativeLimit.isFinite()) negativeLimit = 0.0
        return BasisResidualLimits(
            negative = negativeLimit.coerceAtLeast(0.0),
            positive = positiveLimit.coerceAtLeast(0.0),
        )
    }

    private fun scaledBasisResidualCoefficient(
        control: Double,
        limits: BasisResidualLimits,
    ): Double {
        val clampedControl = control.coerceIn(-1.0, 1.0)
        return if (clampedControl >= 0.0) {
            clampedControl * limits.positive * BASIS_DEFORMATION_FRACTION
        } else {
            clampedControl * limits.negative * BASIS_DEFORMATION_FRACTION
        }
    }

    private fun linearLuminance(rgb: DoubleArray): Double =
        multiply3x3Vector(SRGB_D65_TO_XYZ, rgb)[1].coerceIn(0.0, 1.0)

    private fun linearChroma(rgb: DoubleArray): Double {
        val max = maxOf(rgb[0], rgb[1], rgb[2])
        if (max <= EPSILON) return 0.0
        val min = minOf(rgb[0], rgb[1], rgb[2])
        return ((max - min) / max).coerceIn(0.0, 1.0)
    }

    private fun complementaryMixProfile(rgb: DoubleArray): ComplementaryMixProfile {
        val max = maxOf(rgb[0], rgb[1], rgb[2])
        if (max <= EPSILON) return ComplementaryMixProfile(0.0, 0.0, 0.0, 0.0)

        val normalisedRgb = doubleArrayOf(
            rgb[0] / max,
            rgb[1] / max,
            rgb[2] / max,
        )
        return ComplementaryMixProfile(
            chroma = linearChroma(rgb),
            redScore = (normalisedRgb[0] - 0.5 * (normalisedRgb[1] + normalisedRgb[2])).coerceIn(0.0, 1.0),
            blueScore = (normalisedRgb[2] - 0.5 * (normalisedRgb[0] + normalisedRgb[1])).coerceIn(0.0, 1.0),
            yellowScore = (minOf(normalisedRgb[0], normalisedRgb[1]) * (1.0 - normalisedRgb[2])).coerceIn(0.0, 1.0),
        )
    }

    private fun darkChromaticWeight(chroma: Double, luminance: Double): Double {
        val p = params
        val chromaDenominator = (1.0 - p.darkChromaticChromaThreshold).coerceAtLeast(EPSILON)
        val chromaWeight = ((chroma - p.darkChromaticChromaThreshold) / chromaDenominator).coerceIn(0.0, 1.0)
        val luminanceThreshold = p.darkChromaticLuminanceThreshold.coerceAtLeast(EPSILON)
        val luminanceWeight = ((luminanceThreshold - luminance) / luminanceThreshold).coerceIn(0.0, 1.0)
        return chromaWeight * luminanceWeight
    }

    private fun gaussian(t: Double, center: Double, width: Double): Double {
        val scaled = (t - center) / width.coerceAtLeast(EPSILON)
        return exp(-0.5 * scaled * scaled)
    }

    private fun xyzNullResidualBasis(raw: DoubleArray): DoubleArray {
        val rhs = doubleArrayOf(
            spectralDot(raw, X_BAR),
            spectralDot(raw, Y_BAR),
            spectralDot(raw, Z_BAR),
        )
        val coeffs = solve3x3(XYZ_GRAM, rhs) ?: doubleArrayOf(0.0, 0.0, 0.0)
        val corrected = DoubleArray(SPECTRAL_SAMPLES) { index ->
            raw[index] -
                coeffs[0] * X_BAR[index] -
                coeffs[1] * Y_BAR[index] -
                coeffs[2] * Z_BAR[index]
        }
        val maxAbs = corrected.maxOf { abs(it) }.coerceAtLeast(EPSILON)
        return DoubleArray(SPECTRAL_SAMPLES) { index -> corrected[index] / maxAbs }
    }

    private fun reflectanceToKs(reflectance: Double): Double {
        val r = reflectance.coerceIn(EPSILON, 1.0)
        return ((1.0 - r) * (1.0 - r)) / (2.0 * r)
    }

    private fun ksToReflectance(ks: Double): Double =
        (1.0 + ks - sqrt(ks * ks + 2.0 * ks)).coerceIn(EPSILON, 1.0)

    private fun multiply3x3Vector(matrix: Array<DoubleArray>, vector: DoubleArray): DoubleArray =
        DoubleArray(3) { row ->
            matrix[row][0] * vector[0] + matrix[row][1] * vector[1] + matrix[row][2] * vector[2]
        }

    private fun isNeutral(linearRgb: DoubleArray): Boolean {
        val max = maxOf(linearRgb[0], linearRgb[1], linearRgb[2])
        val min = minOf(linearRgb[0], linearRgb[1], linearRgb[2])
        return max - min <= NEUTRAL_LINEAR_TOLERANCE
    }

    // ── Sigmoid helpers ───────────────────────────────────────────────────

    private fun sigmoid(x: Double): Double = 1.0 / (1.0 + exp(-x.coerceIn(-80.0, 80.0)))
    private fun lerp(start: Double, end: Double, t: Double): Double = start + (end - start) * t.coerceIn(0.0, 1.0)
    private fun logit(p: Double): Double = ln(p / (1.0 - p))
    private fun sqr(x: Double): Double = x * x

    /** Solve a 3×3 linear system via Cramer's rule. */
    private fun solve3x3(m: Array<DoubleArray>, b: DoubleArray): DoubleArray? {
        val det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
            m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
            m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
        if (abs(det) < 1e-20) return null
        val invDet = 1.0 / det
        return doubleArrayOf(
            (b[0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
                m[0][1] * (b[1] * m[2][2] - m[1][2] * b[2]) +
                m[0][2] * (b[1] * m[2][1] - m[1][1] * b[2])) * invDet,
            (m[0][0] * (b[1] * m[2][2] - m[1][2] * b[2]) -
                b[0] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                m[0][2] * (m[1][0] * b[2] - b[1] * m[2][0])) * invDet,
            (m[0][0] * (m[1][1] * b[2] - b[1] * m[2][1]) -
                m[0][1] * (m[1][0] * b[2] - b[1] * m[2][0]) +
                b[0] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) * invDet,
        )
    }

    /** Solve an N×N linear system via Gaussian elimination with partial pivoting. */
    private fun solveNxN(m: Array<DoubleArray>, b: DoubleArray): DoubleArray? {
        val n = m.size
        val a = Array(n) { row ->
            DoubleArray(n + 1) { col ->
                if (col < n) m[row][col] else b[row]
            }
        }
        for (col in 0 until n) {
            var maxRow = col
            var maxVal = abs(a[col][col])
            for (row in col + 1 until n) {
                val v = abs(a[row][col])
                if (v > maxVal) { maxVal = v; maxRow = row }
            }
            if (maxVal < 1e-20) return null
            if (maxRow != col) { val tmp = a[col]; a[col] = a[maxRow]; a[maxRow] = tmp }
            val pivot = a[col][col]
            for (row in col + 1 until n) {
                val factor = a[row][col] / pivot
                for (k in col until n + 1) a[row][k] -= factor * a[col][k]
            }
        }
        val x = DoubleArray(n)
        for (row in n - 1 downTo 0) {
            var sum = a[row][n]
            for (k in row + 1 until n) sum -= a[row][k] * x[k]
            x[row] = sum / a[row][row]
        }
        return x
    }

    // ── sRGB ↔ linear (IEC 61966-2-1) ─────────────────────────────────────

    fun srgbChannelToLinear(v: Double): Double =
        if (v <= 0.04045) v / 12.92
        else ((v + 0.055) / 1.055).pow(2.4)

    fun linearChannelToSrgb(v: Double): Double =
        if (v <= 0.0031308) (v * 12.92).coerceIn(0.0, 1.0)
        else ((1.055 * v.pow(1.0 / 2.4)) - 0.055).coerceIn(0.0, 1.0)

    private data class PigmentEstimate(
        val absorption: DoubleArray,
        val scattering: DoubleArray,
    )
}
