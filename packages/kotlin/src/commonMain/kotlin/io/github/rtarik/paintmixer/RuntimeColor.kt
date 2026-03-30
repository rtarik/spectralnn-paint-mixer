package io.github.rtarik.paintmixer

internal data class Color(
    val red: Float,
    val green: Float,
    val blue: Float,
    val alpha: Float = 1f,
) {
    init {
        require(red in 0f..1f) { "red must be in 0..1, got $red" }
        require(green in 0f..1f) { "green must be in 0..1, got $green" }
        require(blue in 0f..1f) { "blue must be in 0..1, got $blue" }
        require(alpha in 0f..1f) { "alpha must be in 0..1, got $alpha" }
    }
}

internal data class PaletteColor(
    val color: Color,
)

internal fun SrgbColor.toRuntimeColor(): Color =
    Color(
        red = red,
        green = green,
        blue = blue,
        alpha = 1f,
    )

internal fun Color.toSrgbColor(): SrgbColor =
    SrgbColor.fromUnitRgb(
        red = red,
        green = green,
        blue = blue,
    )

