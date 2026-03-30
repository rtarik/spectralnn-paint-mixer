package io.github.rtarik.paintmixer

interface PaintMixer {
    fun mixOrNull(portions: List<MixPortion>): SrgbColor?
}

