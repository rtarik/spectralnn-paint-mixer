package io.github.rtarik.paintmixer

internal object LearnedResidualCorrectionModel : ResidualCorrectionModel {
    override val modelId: String
        get() = DefaultModelArtifact.runtime.modelId

    override val expectedBaseEngineId: String
        get() = DefaultModelArtifact.runtime.baseEngineId

    override fun correct(portions: List<MixPortion>, baseMix: SrgbColor): SrgbColor {
        if (!LearnedMixerModel.isAvailable) return baseMix

        val blend = DefaultModelArtifact.runtime.mixingParameters.learnedMixerBlend
        if (blend <= 0.0) return baseMix

        val runtimeInputs = portions.toRuntimeMixPortions()
        return LearnedMixerModel.predictBlended(
            colors = runtimeInputs.colors,
            parts = runtimeInputs.parts,
            physical = baseMix.toRuntimeColor(),
            blend = blend,
        )?.toSrgbColor() ?: baseMix
    }
}
