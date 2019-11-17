// Import the modules 
let canvas      	= require('canvas');
let faceapi     	= require('face-api.js');
let tfjsLoaded		= false;
let modelsLoaded 	= false;

// Try load in Tfjs-node if it is installed
try {
	require('@tensorflow/tfjs-node');
	tfjsLoaded = true;
}
catch (err) {
	if (err instanceof Error && err.code === "MODULE_NOT_FOUND") {
		var infoMsg = "TensorFlow.js for Node.js was not found, running without it";
		process.send( {"info" : infoMsg} );
		tfjsLoaded = true;
	}
    else {
		var errMsg = "Failed to load in TensorFlow.js for Node.js in child_process: " + err;
		process.send( {"warn" : errMsg} );
		tfjsLoaded = false;
	}
}

// Monkey patch nodejs to faceapi with canvas
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Load the models in at startup
async function loadModels() {
	try {
		const modelPath = `${__dirname}/weights`;
		const ssdMobilenetv1Method          = faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
		const tinyFaceDetectorMethod        = faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
		const faceLandmark68NetMethod       = faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
		const faceLandmark68TinyNetMethod   = faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelPath);
		const faceExpressionNetMethod       = faceapi.nets.faceExpressionNet.loadFromDisk(modelPath);
		const ageGenderNetMethod            = faceapi.nets.ageGenderNet.loadFromDisk(modelPath);
		const faceRecognitionNetMethod      = faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);

		await ssdMobilenetv1Method;
		await tinyFaceDetectorMethod;
		await faceLandmark68NetMethod;
		await faceLandmark68TinyNetMethod;
		await faceExpressionNetMethod;
		await ageGenderNetMethod;
		await faceRecognitionNetMethod;

		modelsLoaded = true;

		const infoMsg = "Loaded models";
		process.send( {"info" : infoMsg} );
	}
	catch (error) {
		const errorMsg = "Failed to load models";
		process.send( {"warn" : errorMsg} );
		modelsLoaded = false;
	}
}
loadModels();

process.on('message', async function(msg) {
	const computeDebug = function (type, inputMsg) {
		if (type === "info") {
			process.send( {"info" : inputMsg} );
		}
		else if (type === "warn") {
			process.send( {"warn" : inputMsg} );
		}
		else if (type === "error") {
			process.send( {"error" : inputMsg} );
		}
	};

	// Check if the models and tfjs are loaded
	if (tfjsLoaded && modelsLoaded){
		if ("image" in msg && "node" in msg) {
			try {
				// Make the node object 
				const node = msg.node;

				// Convert the uint8 array into a buffer
				const inputBuffer = Buffer.from(msg.image.data);
				if (!Buffer.isBuffer(inputBuffer)) {
					var errMsg = "Input msg.payload was not converted to buffer";
					process.send( {"error" : errMsg} );
					return;
				}

				// Debug
				computeDebug("info", "Computing input on node \"" + node.name + "\"")
				const startTime = Date.now();

				// Turn the image into a Canvas
				const img   = new Image;
				img.onload 	= async function () { 
					// Set up the network options
					let options
					if (node.recognitionType === "SSD") options = new faceapi.SsdMobilenetv1Options({ minConfidence: node.confidence })
					else if (node.recognitionType === "Yolo") options = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: node.confidence, inputSize: node.inputSize })

					// Make a forward pass of each network for the detections
					let  detections   = null
					if (node.multipleFaces === "Multiple Faces") {
						// Just Face detection 
						if (!node.landmarks && !node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options)
						}

						// Face detection with either landmarks, expressions, AAG, or descriptors
						else if (node.landmarks && !node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks()
						}
						else if (!node.landmarks && node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceExpressions()
						}
						else if (!node.landmarks && !node.expressions && node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withAgeAndGender()
						}
						else if (!node.landmarks && !node.expressions && !node.ageGender && node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceDescriptors()
						}

						// Face detection with landmarks and either expressions, AAG, or descriptors
						else if (node.landmarks && node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceExpressions()
						}
						else if (node.landmarks && !node.expressions && node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withAgeAndGender()
						}
						else if (node.landmarks && !node.expressions && !node.ageGender && node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceDescriptors()
						}

						// Face detection with landmarks and expressions with either AAG, or descriptors
						else if (node.landmarks && node.expressions && node.ageGender && !node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceExpressions().withAgeAndGender()
						}
						else if (node.landmarks && node.expressions && !node.ageGender && node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceExpressions().withFaceDescriptors() 
						}

						// Face detection with landmarks, AAG, and descriptors, but not expressions
						else if (node.landmarks && !node.expressions && node.ageGender && node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withAgeAndGender().withFaceDescriptors()
						}

						// All possible options
						else if (node.landmarks && node.expressions && node.ageGender && node.recognition) {
							detections = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceExpressions().withAgeAndGender().withFaceDescriptors()
						}

						// Else not supported
						else {
							// Log error
							const errorMsg = "Selected configuration of options for compute node \"" + node.name + "\" not supported"
							computeDebug("warn", errorMsg)
						}
					}
					else {
						// Just Face detection 
						if (!node.landmarks && !node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options)
						}

						// Face detection with either landmarks, expressions, AAG, or descriptors
						else if (node.landmarks && !node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks()
						}
						else if (!node.landmarks && node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceExpressions()
						}
						else if (!node.landmarks && !node.expressions && node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withAgeAndGender()
						}
						else if (!node.landmarks && !node.expressions && !node.ageGender && node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceDescriptor()
						}

						// Face detection with landmarks and either expressions, AAG, or descriptors
						else if (node.landmarks && node.expressions && !node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceExpressions()
						}
						else if (node.landmarks && !node.expressions && node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withAgeAndGender()
						}
						else if (node.landmarks && !node.expressions && !node.ageGender && node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceDescriptor()
						}

						// Face detection with landmarks and expressions with either AAG, or descriptors
						else if (node.landmarks && node.expressions && node.ageGender && !node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceExpressions().withAgeAndGender()
						}
						else if (node.landmarks && node.expressions && !node.ageGender && node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceExpressions().withFaceDescriptor()
						}

						// Face detection with landmarks, AAG, and descriptors, but not expressions
						else if (node.landmarks && !node.expressions && node.ageGender && node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withAgeAndGender().withFaceDescriptor()
						}

						// All possible options
						else if (node.landmarks && node.expressions && node.ageGender && node.recognition) {
							detections = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceExpressions().withAgeAndGender().withFaceDescriptor()
						}

						// Else not supported
						else {
							// Log error
							const errorMsg = "Selected configuration of options for compute node \"" + node.name + "\" not supported"
							computeDebug("warn", errorMsg)
						}

						if (detections === undefined) detections = []
						else detections = [detections]
					}

					// Check if there are ny detections
					if (detections && typeof detections === 'object' && detections.constructor === Array && detections.length > 0) {
						// If recognition is required, check against comparator
						if (node.recognition && node.descriptors) {
							let nameDescriptor      = node.labelName || fileContents.label || "known"
							let floatDescriptor     = []

							// Add each descriptor to an array to add to constructor
							node.descriptors.descriptors.forEach(function (array) {
								floatDescriptor.push(new Float32Array(array))
							})

							// Create a new descriptor for the node 
							const descriptor = new faceapi.LabeledFaceDescriptors(nameDescriptor, floatDescriptor)
							const faceMatcher = new faceapi.FaceMatcher(descriptor)

							// Check if one or multiple faces require matching
							detections.forEach(face => {
								face.bestMatch = faceMatcher.findBestMatch(face.descriptor)						
							})
						}
						else if (node.recognition && !node.descriptors) {
							// Log error
							const errorMsg = "Recognition is selected but there was no descriptor to compare against, please select an image to create a descriptor."
							computeDebug("warn", errorMsg)
						}

						// Draw the information on the image
						const drawImage = async function (img, detections) {
							// Draw the detection rectangle
							const  outImg = faceapi.createCanvasFromMedia(img)

							// Draw the main box
							faceapi.draw.drawDetections(outImg, detections)

							// Draw the landmarks if required
							if (node.landmarks) faceapi.draw.drawFaceLandmarks(outImg, detections)

							// Draw the other optional data
							detections.forEach(result => {
								// Make label for experssion
								const { expressions } = result
								let expressionMaxKey = (node.expressions && expressions) ? Object.keys(expressions).reduce(function(a, b){ 
									return expressions[a] > expressions[b] ? a : b 
								}) : null
								const expressionsLabel = (node.expressions) ? [
									`${ expressionMaxKey } : ${ faceapi.round(expressions[expressionMaxKey]*100, 0) }%`
								] : []
								// console.log(expressionsLabel)

								// Make label for age and gender
								const { age, gender, genderProbability } = result
								const ageGenderLabel = (node.ageGender && age && gender && genderProbability) ? [
									`${ gender } : ${ faceapi.round(genderProbability*100) }%`,
									`${ faceapi.round(age, 0) } years`
								] : []
								// console.log(ageGenderLabel)

								// Add the face recognition confidence
								const { bestMatch } = result
								const recognitionLabel = (node.recognition && bestMatch) ? [
									`${ bestMatch["_label"] } (${ faceapi.round(bestMatch["_distance"], 2) })`,
								] : []
								// console.log(recognitionLabel)

								// Draw the optional Labels for the current face
								if (expressionsLabel.length || ageGenderLabel.length || recognitionLabel.length) {
									new faceapi.draw.DrawTextField(
										[ 
											...expressionsLabel,
											...ageGenderLabel,
											...recognitionLabel
										],
										result.detection.box.bottomLeft
									).draw(outImg)
								}
							})
							return outImg.toBuffer('image/jpeg')
						}
						const newImg = await drawImage(img, detections)
						
						// Create msg.payload from the detections object
						let msg = {}
						msg["payload"]          = []
						msg["image"]            = newImg
						msg["inferenceTime"]    = Date.now() - startTime
						detections.forEach(result => {
							// Get the info of the base detection
							const { detection } = result
							const FaceDetection = (detection) ? {
								"imageDims" : detection._imageDims,
								"score" : detection._score,
								"classScore" : detection._classScore,
								"className" : detection._className
							} : {
								"imageDims" : result._imageDims,
								"score" : result._score,
								"classScore" : result._classScore,
								"className" : result._className
							}

							// Get the landmarks
							const { landmarks, unshiftedLandmarks, alignedRect } = result
							const FacialLandmarks = (node.landmarks && landmarks && unshiftedLandmarks) ? {
								"landmarks" : {
									"_imageDims" : landmarks._imageDims,
									"_shift" : landmarks._shift,
									"_positions" : landmarks._positions
								},
								"unshiftedLandmarks" : {
									"_imageDims" : unshiftedLandmarks._imageDims,
									"_shift" : unshiftedLandmarks._shift,
									"_positions" : unshiftedLandmarks._positions
								},
								"alignedRect" : {
									"_imageDims" : alignedRect._imageDims,
									"_score" : alignedRect._score,
									"_classScore" : alignedRect._classScore,
									"_className" : alignedRect._className,
									"_box" : alignedRect._box,
								}
							} : null

							// Get the expressions and calculate the max score
							const { expressions } = result
							let expressionMaxKey = (node.expressions && expressions) ? Object.keys(expressions).reduce(function(a, b){ 
								return expressions[a] > expressions[b] ? a : b 
							}) : null
							const FacialExpressions = (expressions) ? {
									"expressionLabel" : expressionMaxKey,
									"expressionScore" : expressions[expressionMaxKey],
									"expressions" : {
										"neutral": expressions.neutral,
										"happy": expressions.happy,
										"sad": expressions.sad,
										"angry": expressions.angry,
										"fearful": expressions.fearful,
										"disgusted": expressions.disgusted,
										"surprised": expressions.surprised
									}
							} : null

							// Get the age and gender results
							const { age, gender, genderProbability } = result
							const AgeAndGender = (node.ageGender && age && gender && genderProbability) ? {
								"gender" : gender,
								"age" : age,
								"genderProbability" : genderProbability
							} : null

							// Get the Face recognition scores
							const { bestMatch, descriptor } = result
							const BestMatch = (node.recognition && bestMatch && descriptor) ? {
								"matchedLabel" : bestMatch._label,
								"matchedDistance" : bestMatch._distance,
								"descriptor" : descriptor
							} : null

							// Concat the objects to create output message
							msg.payload.push({
								...FaceDetection,
								...FacialLandmarks,
								...FacialExpressions,
								...AgeAndGender,
								...BestMatch
							})
						})                        
						
						// Callback with the new message
						process.send( msg );
					}
					else if (detections && typeof detections === 'object' && detections.constructor === Array && detections.length == 0) {
						let msg = {}
						msg["payload"]          = []
						msg["image"]            = inputBuffer
						msg["inferenceTime"]    = Date.now() - startTime
						process.send( msg );
					}
					else {
						// Log error
						const errorMsg = "No detections found for input"
						computeDebug("warn", errorMsg)
					}
				};
				img.onerror = err => { 
					const errorMsg = "Failed to load input image into Canvas";
					computeDebug("error", errorMsg)
				};
				img.src     = inputBuffer;
			}
			catch (error) {
				// Log error
				const errorMsg = "Error computing detections: " + error
				computeDebug("error", errorMsg)
			}
		}
		else {
			const errorMsg = "Image or node not sent in message to child"
			computeDebug("warn", errorMsg )
		}
	}
});