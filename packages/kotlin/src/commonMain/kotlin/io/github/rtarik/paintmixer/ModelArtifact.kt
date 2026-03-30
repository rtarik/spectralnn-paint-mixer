package io.github.rtarik.paintmixer

import kotlinx.serialization.Serializable

@Serializable
internal data class ModelArtifact(
    val artifactVersion: Int,
    val modelId: String,
    val createdAt: String,
    val runtimeContract: RuntimeContract,
    val trainingSummary: TrainingSummary,
    val mixingParameters: MixingParameters,
    val normalization: Normalization,
    val network: Network,
    val provenance: Provenance,
)

@Serializable
internal data class RuntimeContract(
    val colorSpace: String,
    val internalColorSpace: String,
    val modelOutputSpace: String,
    val baseEngineId: String,
    val maxColors: Int,
    val featureSchemaVersion: Int,
    val featureLayout: List<String>,
    val supportsResidualPhysicalInput: Boolean,
)

@Serializable
internal data class TrainingSummary(
    val syntheticTrain: Int,
    val syntheticVal: Int,
    val curatedTrain: Int,
    val curatedHoldout: Int,
    val curatedTotal: Int,
    val warmStart: String,
    val curatedFullMeanDeltaE: Double,
    val curatedFullP95DeltaE: Double,
    val curatedFullMaxDeltaE: Double,
    val curatedHoldoutMeanDeltaE: Double,
    val curatedHoldoutP95DeltaE: Double,
    val curatedHoldoutMaxDeltaE: Double,
)

@Serializable
internal data class Normalization(
    val featureMean: List<Double>,
    val featureStd: List<Double>,
    val targetMean: List<Double>,
    val targetStd: List<Double>,
)

@Serializable
internal data class Network(
    val architecture: String,
    val activation: String,
    val inputDim: Int,
    val hiddenDims: List<Int>,
    val outputDim: Int,
    val weights: NetworkWeights,
)

@Serializable
internal data class NetworkWeights(
    val w1: List<List<Double>>,
    val b1: List<Double>,
    val w2: List<List<Double>>,
    val b2: List<Double>,
    val w3: List<List<Double>>,
    val b3: List<Double>,
)

@Serializable
internal data class Provenance(
    val sourceCheckpoint: String,
    val sourceReport: String,
    val sourceMixingParameters: String,
    val generator: String,
)
