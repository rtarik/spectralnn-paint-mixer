package io.github.rtarik.paintmixer

data class MixPortion(
    val color: SrgbColor,
    val parts: Int,
) {
    init {
        require(parts > 0) { "parts must be greater than zero, got $parts" }
    }
}

