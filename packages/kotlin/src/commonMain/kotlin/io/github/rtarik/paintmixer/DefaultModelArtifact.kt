package io.github.rtarik.paintmixer

import kotlinx.serialization.json.Json

internal object DefaultModelArtifact {

    private val json = Json {
        ignoreUnknownKeys = true
    }

    val runtime: RuntimeModelArtifact by lazy {
        json.decodeFromString<ModelArtifact>(DefaultModelArtifactJson.value).toRuntime()
    }
}

internal data class RuntimeModelArtifact(
    val artifactVersion: Int,
    val modelId: String,
    val createdAt: String,
    val baseEngineId: String,
    val mixingParameters: MixingParameters,
    val inputDim: Int,
    val hiddenDims: List<Int>,
    val outputDim: Int,
    val featureMean: DoubleArray,
    val featureStd: DoubleArray,
    val targetMean: DoubleArray,
    val targetStd: DoubleArray,
    val w1: Array<DoubleArray>,
    val b1: DoubleArray,
    val w2: Array<DoubleArray>,
    val b2: DoubleArray,
    val w3: Array<DoubleArray>,
    val b3: DoubleArray,
)

private fun ModelArtifact.toRuntime(): RuntimeModelArtifact =
    RuntimeModelArtifact(
        artifactVersion = artifactVersion,
        modelId = modelId,
        createdAt = createdAt,
        baseEngineId = runtimeContract.baseEngineId,
        mixingParameters = mixingParameters,
        inputDim = network.inputDim,
        hiddenDims = network.hiddenDims,
        outputDim = network.outputDim,
        featureMean = normalization.featureMean.toDoubleArray(),
        featureStd = normalization.featureStd.toDoubleArray(),
        targetMean = normalization.targetMean.toDoubleArray(),
        targetStd = normalization.targetStd.toDoubleArray(),
        w1 = network.weights.w1.map { row -> row.toDoubleArray() }.toTypedArray(),
        b1 = network.weights.b1.toDoubleArray(),
        w2 = network.weights.w2.map { row -> row.toDoubleArray() }.toTypedArray(),
        b2 = network.weights.b2.toDoubleArray(),
        w3 = network.weights.w3.map { row -> row.toDoubleArray() }.toTypedArray(),
        b3 = network.weights.b3.toDoubleArray(),
    )
