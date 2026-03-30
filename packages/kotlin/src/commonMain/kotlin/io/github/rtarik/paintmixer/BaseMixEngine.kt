package io.github.rtarik.paintmixer

interface BaseMixEngine {
    val engineId: String

    fun mixOrNull(portions: List<MixPortion>): SrgbColor?
}
