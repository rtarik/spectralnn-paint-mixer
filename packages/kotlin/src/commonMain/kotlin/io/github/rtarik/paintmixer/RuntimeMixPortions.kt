package io.github.rtarik.paintmixer

internal data class RuntimeMixPortions(
    val colors: List<PaletteColor>,
    val parts: List<Int>,
)

internal fun List<MixPortion>.toRuntimeMixPortions(): RuntimeMixPortions =
    RuntimeMixPortions(
        colors = map { portion -> PaletteColor(portion.color.toRuntimeColor()) },
        parts = map { portion -> portion.parts },
    )
