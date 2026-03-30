package io.github.rtarik.paintmixer

import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.math.tanh

internal object LearnedMixerModel {

    private const val MAX_COLORS = 3
    private const val BASE_INPUT_DIM = 20
    private const val PHYSICAL_INPUT_DIM = 3
    private const val OUTPUT_DIM = 3
    private const val EPSILON = 1e-12

    private data class FeatureEntry(
        val rgb: DoubleArray,
        val weight: Double,
        val luminance: Double,
        val chroma: Double,
        val redScore: Double,
        val blueScore: Double,
        val yellowScore: Double,
        val darkWeight: Double,
    )

    val isAvailable: Boolean
        get() = LearnedMixerModelWeights.enabled && hasValidShapes()

    fun predictBlended(
        colors: List<PaletteColor>,
        parts: List<Int>,
        physical: Color,
        blend: Double,
    ): Color? {
        require(colors.size == parts.size) { "colors and parts must have equal size" }
        if (!isAvailable) return null
        val amount = blend.coerceIn(0.0, 1.0)
        if (amount <= 0.0) return physical

        val active = colors.indices.filter { parts[it] > 0 }
        if (active.isEmpty()) return null
        if (active.size > MAX_COLORS) return null

        val features = buildFeatures(colors, parts, physical)
        val standardised = DoubleArray(LearnedMixerModelWeights.inputDim) { index ->
            (features[index] - LearnedMixerModelWeights.featureMean[index]) /
                LearnedMixerModelWeights.featureStd[index]
        }
        val hidden1 = denseLayer(
            input = standardised,
            weights = LearnedMixerModelWeights.layer1Weights,
            bias = LearnedMixerModelWeights.layer1Bias,
            activate = true,
        )
        val hidden2 = denseLayer(
            input = hidden1,
            weights = LearnedMixerModelWeights.layer2Weights,
            bias = LearnedMixerModelWeights.layer2Bias,
            activate = true,
        )
        val output = denseLayer(
            input = hidden2,
            weights = LearnedMixerModelWeights.outputWeights,
            bias = LearnedMixerModelWeights.outputBias,
            activate = false,
        )
        val outputVector = DoubleArray(OUTPUT_DIM) { index ->
            output[index] * LearnedMixerModelWeights.targetStd[index] +
                LearnedMixerModelWeights.targetMean[index]
        }
        return if (usesResidualModel()) {
            val physicalLab = colorToOklab(physical)
            val correctedLab = DoubleArray(OUTPUT_DIM) { index ->
                physicalLab[index] + outputVector[index] * amount
            }
            oklabToColor(correctedLab)
        } else {
            val learned = oklabToColor(outputVector)
            blendWithPhysical(physical, learned, amount)
        }
    }

    fun blendWithPhysical(physical: Color, learned: Color, blend: Double): Color {
        val amount = blend.coerceIn(0.0, 1.0)
        if (amount <= 0.0) return physical
        if (amount >= 1.0) return learned

        val physicalLab = colorToOklab(physical)
        val learnedLab = colorToOklab(learned)
        val blended = DoubleArray(OUTPUT_DIM) { index ->
            physicalLab[index] + (learnedLab[index] - physicalLab[index]) * amount
        }
        return oklabToColor(blended)
    }

    private fun buildFeatures(
        colors: List<PaletteColor>,
        parts: List<Int>,
        physical: Color,
    ): DoubleArray {
        val activeIndices = colors.indices.filter { parts[it] > 0 }
        val totalParts = activeIndices.sumOf { parts[it] }.coerceAtLeast(1)
        val entries = activeIndices.map { index ->
            val rgb = colorToLinearRgb(colors[index].color)
            val (redScore, blueScore, yellowScore) = colorRoleScores(rgb)
            FeatureEntry(
                rgb = rgb,
                weight = parts[index].toDouble() / totalParts.toDouble(),
                luminance = luminance(rgb),
                chroma = chroma(rgb),
                redScore = redScore,
                blueScore = blueScore,
                yellowScore = yellowScore,
                darkWeight = darkChromaticWeight(rgb),
            )
        }.sortedWith(
            compareByDescending<FeatureEntry> { it.weight }
                .thenByDescending { it.rgb[0] }
                .thenByDescending { it.rgb[1] }
                .thenByDescending { it.rgb[2] }
        )

        val features = DoubleArray(LearnedMixerModelWeights.inputDim)
        var featureIndex = 0
        for (slot in 0 until MAX_COLORS) {
            if (slot < entries.size) {
                val entry = entries[slot]
                features[featureIndex] = entry.rgb[0]
                features[featureIndex + 1] = entry.rgb[1]
                features[featureIndex + 2] = entry.rgb[2]
                features[featureIndex + 3] = entry.weight
            }
            featureIndex += 4
        }

        val weightedMeanRgb = DoubleArray(3)
        var weightedMeanLuminance = 0.0
        for (entry in entries) {
            weightedMeanRgb[0] += entry.rgb[0] * entry.weight
            weightedMeanRgb[1] += entry.rgb[1] * entry.weight
            weightedMeanRgb[2] += entry.rgb[2] * entry.weight
            weightedMeanLuminance += entry.luminance * entry.weight
        }
        val (violetStress, yellowBlueStress, darkStress) = pairStresses(entries)

        features[featureIndex] = entries.size.toDouble() / MAX_COLORS.toDouble()
        featureIndex += 1
        features[featureIndex] = weightedMeanRgb[0]
        features[featureIndex + 1] = weightedMeanRgb[1]
        features[featureIndex + 2] = weightedMeanRgb[2]
        featureIndex += 3
        features[featureIndex] = weightedMeanLuminance
        featureIndex += 1
        features[featureIndex] = violetStress
        featureIndex += 1
        features[featureIndex] = yellowBlueStress
        featureIndex += 1
        features[featureIndex] = darkStress
        featureIndex += 1

        if (usesResidualModel() && LearnedMixerModelWeights.inputDim >= BASE_INPUT_DIM + PHYSICAL_INPUT_DIM) {
            val physicalLab = colorToOklab(physical)
            features[featureIndex] = physicalLab[0]
            features[featureIndex + 1] = physicalLab[1]
            features[featureIndex + 2] = physicalLab[2]
        }
        return features
    }

    private fun pairStresses(entries: List<FeatureEntry>): Triple<Double, Double, Double> {
        var violet = 0.0
        var yellowBlue = 0.0
        var dark = 0.0
        if (entries.size < 2) return Triple(violet, yellowBlue, dark)

        for (leftIndex in 0 until entries.lastIndex) {
            val left = entries[leftIndex]
            for (rightIndex in leftIndex + 1 until entries.size) {
                val right = entries[rightIndex]
                val pairBalance = sqrt((left.weight * right.weight / 0.25).coerceIn(0.0, 1.0))
                val chromaStress = sqrt(left.chroma * right.chroma)
                val violetPair = max(
                    left.redScore * right.blueScore,
                    left.blueScore * right.redScore,
                )
                val yellowBluePair = max(
                    left.blueScore * right.yellowScore,
                    left.yellowScore * right.blueScore,
                )
                violet = max(violet, pairBalance * chromaStress * violetPair)
                yellowBlue = max(yellowBlue, pairBalance * chromaStress * yellowBluePair)
                dark = max(dark, pairBalance * sqrt(left.darkWeight * right.darkWeight))
            }
        }
        return Triple(violet, yellowBlue, dark)
    }

    private fun colorToLinearRgb(color: Color): DoubleArray = doubleArrayOf(
        SpectralData.srgbChannelToLinear(color.red.toDouble()),
        SpectralData.srgbChannelToLinear(color.green.toDouble()),
        SpectralData.srgbChannelToLinear(color.blue.toDouble()),
    )

    private fun luminance(rgb: DoubleArray): Double =
        0.21263900587151033 * rgb[0] +
            0.7151686787677553 * rgb[1] +
            0.07219231536073373 * rgb[2]

    private fun chroma(rgb: DoubleArray): Double {
        val maxChannel = max(rgb[0], max(rgb[1], rgb[2]))
        if (maxChannel <= 1e-8) return 0.0
        val minChannel = minOf(rgb[0], rgb[1], rgb[2])
        return ((maxChannel - minChannel) / maxChannel).coerceIn(0.0, 1.0)
    }

    private fun colorRoleScores(rgb: DoubleArray): Triple<Double, Double, Double> {
        val maxChannel = max(rgb[0], max(rgb[1], rgb[2]))
        if (maxChannel <= 1e-8) return Triple(0.0, 0.0, 0.0)

        val normalisedR = rgb[0] / maxChannel
        val normalisedG = rgb[1] / maxChannel
        val normalisedB = rgb[2] / maxChannel
        val redScore = (normalisedR - 0.5 * (normalisedG + normalisedB)).coerceIn(0.0, 1.0)
        val blueScore = (normalisedB - 0.5 * (normalisedR + normalisedG)).coerceIn(0.0, 1.0)
        val yellowScore = (minOf(normalisedR, normalisedG) * (1.0 - normalisedB)).coerceIn(0.0, 1.0)
        return Triple(redScore, blueScore, yellowScore)
    }

    private fun darkChromaticWeight(rgb: DoubleArray): Double {
        val luma = luminance(rgb)
        val colorfulness = chroma(rgb)
        val chromaWeight = ((colorfulness - 0.45) / 0.55).coerceIn(0.0, 1.0)
        val luminanceWeight = ((0.35 - luma) / 0.35).coerceIn(0.0, 1.0)
        return chromaWeight * luminanceWeight
    }

    private fun denseLayer(
        input: DoubleArray,
        weights: Array<DoubleArray>,
        bias: DoubleArray,
        activate: Boolean,
    ): DoubleArray {
        val output = DoubleArray(weights.size)
        for (rowIndex in weights.indices) {
            val row = weights[rowIndex]
            var sum = bias[rowIndex]
            for (columnIndex in input.indices) {
                sum += row[columnIndex] * input[columnIndex]
            }
            output[rowIndex] = if (activate) tanh(sum) else sum
        }
        return output
    }

    private fun colorToOklab(color: Color): DoubleArray =
        linearRgbToOklab(colorToLinearRgb(color))

    private fun linearRgbToOklab(rgb: DoubleArray): DoubleArray {
        val l = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]
        val m = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]
        val s = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]

        val lRoot = max(l, EPSILON).pow(1.0 / 3.0)
        val mRoot = max(m, EPSILON).pow(1.0 / 3.0)
        val sRoot = max(s, EPSILON).pow(1.0 / 3.0)

        return doubleArrayOf(
            0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
            1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
            0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
        )
    }

    private fun oklabToColor(lab: DoubleArray): Color {
        val lPrime = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]
        val mPrime = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]
        val sPrime = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2]

        val l = lPrime * lPrime * lPrime
        val m = mPrime * mPrime * mPrime
        val s = sPrime * sPrime * sPrime

        val linearR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
        val linearG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
        val linearB = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

        return Color(
            red = SpectralData.linearChannelToSrgb(linearR.coerceIn(0.0, 1.0)).toFloat(),
            green = SpectralData.linearChannelToSrgb(linearG.coerceIn(0.0, 1.0)).toFloat(),
            blue = SpectralData.linearChannelToSrgb(linearB.coerceIn(0.0, 1.0)).toFloat(),
            alpha = 1f,
        )
    }

    private fun hasValidShapes(): Boolean =
        LearnedMixerModelWeights.inputDim >= BASE_INPUT_DIM &&
            LearnedMixerModelWeights.featureMean.size == LearnedMixerModelWeights.inputDim &&
            LearnedMixerModelWeights.featureStd.size == LearnedMixerModelWeights.inputDim &&
            LearnedMixerModelWeights.targetMean.size == OUTPUT_DIM &&
            LearnedMixerModelWeights.targetStd.size == OUTPUT_DIM &&
            LearnedMixerModelWeights.layer1Weights.size == LearnedMixerModelWeights.hidden1Dim &&
            LearnedMixerModelWeights.layer1Weights.all { it.size == LearnedMixerModelWeights.inputDim } &&
            LearnedMixerModelWeights.layer1Bias.size == LearnedMixerModelWeights.hidden1Dim &&
            LearnedMixerModelWeights.layer2Weights.size == LearnedMixerModelWeights.hidden2Dim &&
            LearnedMixerModelWeights.layer2Weights.all { it.size == LearnedMixerModelWeights.hidden1Dim } &&
            LearnedMixerModelWeights.layer2Bias.size == LearnedMixerModelWeights.hidden2Dim &&
            LearnedMixerModelWeights.outputWeights.size == OUTPUT_DIM &&
            LearnedMixerModelWeights.outputWeights.all { it.size == LearnedMixerModelWeights.hidden2Dim } &&
            LearnedMixerModelWeights.outputBias.size == OUTPUT_DIM

    private fun usesResidualModel(): Boolean =
        LearnedMixerModelWeights.inputDim >= BASE_INPUT_DIM + PHYSICAL_INPUT_DIM
}
