package io.github.rtarik.paintmixer

object PaintMixers {
    private val spectralBaseEngine: BaseMixEngine = SpectralBaseMixEngine
    private val learnedResidualCorrection: ResidualCorrectionModel = LearnedResidualCorrectionModel
    private val defaultMixer: PaintMixer = PipelinePaintMixer(
        baseEngine = spectralBaseEngine,
        correctionModel = learnedResidualCorrection,
    )

    fun default(): PaintMixer = defaultMixer

    fun spectralBase(): BaseMixEngine = spectralBaseEngine

    fun learnedResidual(): ResidualCorrectionModel = learnedResidualCorrection

    fun pipeline(
        baseEngine: BaseMixEngine,
        correctionModel: ResidualCorrectionModel? = null,
    ): PaintMixer = PipelinePaintMixer(baseEngine = baseEngine, correctionModel = correctionModel)
}
