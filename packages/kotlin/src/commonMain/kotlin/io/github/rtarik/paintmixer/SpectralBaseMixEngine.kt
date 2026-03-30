package io.github.rtarik.paintmixer
/**
 * Subtractive color mixing using Kubelka-Munk K/S averaging.
 *
 * Each sRGB colour is upsampled to a pigment-like spectral reflectance curve,
 * converted to K/S absorption values, remapped into effective concentrations,
 * and then converted back to sRGB.
 *
 * This spectral approach correctly produces green when mixing blue and yellow —
 * something that 3-channel RGB/CMY models cannot do because they lose the
 * wavelength-by-wavelength overlap information.
 *
 * Absorption (K) values are combined using a power mean with exponent < 1,
 * which softens the compounding of absorption and produces brighter, more
 * realistic secondary colours (e.g. a visible purple from red + blue instead
 * of a muddy near-black).
 */
internal object SpectralBaseMixEngine : BaseMixEngine {

    override val engineId: String = "spectral_ks_v1"

    /** Small guard value to avoid 0^p issues. */
    internal const val EPSILON = 1e-12

    /**
     * Mix [colors] in the given [parts] ratio using subtractive logic.
     * Returns null when total parts is zero (nothing to mix).
     */
    override fun mixOrNull(portions: List<MixPortion>): SrgbColor? {
        if (portions.isEmpty()) return null

        val runtimeInputs = portions.toRuntimeMixPortions()
        val colors = runtimeInputs.colors
        val parts = runtimeInputs.parts

        val activeIndices = parts.indices.filter { parts[it] > 0 }
        if (activeIndices.isEmpty()) return null
        // Preserve the original swatch exactly when there is no actual mixing.
        if (activeIndices.size == 1) return colors[activeIndices.first()].color.toSrgbColor()

        val mixSpaces = Array(colors.size) { index ->
            SpectralData.colorToMixSpace(colors[index].color)
        }
        val reflectances = Array(colors.size) { index ->
            SpectralData.colorToReflectance(colors[index].color)
        }
        val darkChromaticWeights = DoubleArray(colors.size) { index ->
            SpectralData.colorDarkChromaticWeight(colors[index].color)
        }
        val reflectanceLuminances = DoubleArray(colors.size) { index ->
            SpectralData.reflectanceLuminance(reflectances[index])
        }
        val complementaryProfiles = Array(colors.size) { index ->
            SpectralData.colorComplementaryProfile(colors[index].color)
        }
        val physicalMix = SpectralData.mixPreparedToColor(
            mixSpaces = mixSpaces,
            reflectances = reflectances,
            darkChromaticWeights = darkChromaticWeights,
            reflectanceLuminances = reflectanceLuminances,
            complementaryProfiles = complementaryProfiles,
            parts = IntArray(parts.size) { index -> parts[index] },
        )
        return physicalMix?.toSrgbColor()
    }
}
