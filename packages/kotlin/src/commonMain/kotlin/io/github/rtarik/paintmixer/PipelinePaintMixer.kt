package io.github.rtarik.paintmixer

class PipelinePaintMixer(
    val baseEngine: BaseMixEngine,
    val correctionModel: ResidualCorrectionModel? = null,
) : PaintMixer {
    override fun mixOrNull(portions: List<MixPortion>): SrgbColor? {
        val baseMix = baseEngine.mixOrNull(portions) ?: return null
        if (correctionModel == null || portions.size <= 1) return baseMix
        return correctionModel.correct(portions, baseMix)
    }
}
