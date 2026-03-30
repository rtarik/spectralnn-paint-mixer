package io.github.rtarik.paintmixer

interface ResidualCorrectionModel {
    val modelId: String
    val expectedBaseEngineId: String?

    fun correct(portions: List<MixPortion>, baseMix: SrgbColor): SrgbColor
}
