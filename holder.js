// Start the child node if required or kill it
if (node.childHost) {
    // Set up args and options for the child 
    const args = [];
    const options = { stdio: "pipe" };

    // Start the forked child process
    node.childProcess = require('child_process').fork(`${__dirname}/face-api-cmd.js`, args, options)

    // Create the callback to handle a message event for info and warn messages
    node.childProcess.on('message', (msg) => {
        // Route the message appropriately 
        if ("info" in msg) {
            RED.log.info("[Face-api.js : " + node.id + " : Child Node] - " + msg.info)
        }
        else if ("warn" in msg) {
            RED.log.warn("[Face-api.js : " + node.id + " : Child Node] - " + msg.warn)
        }
        else if ("error" in msg) {
            RED.log.error("[Face-api.js : " + node.id + " : Child Node] - " + msg.error)
        }
        else {
            msg.image = Buffer.from(msg.image)
        }

        // Send messages to the callback if it has been set
        if (node.msgCallback) {
            node.msgCallback(msg);
            // if (!("info" in msg)) node.msgCallback = null
        }

        // Set the computing boolean to false
        node.isComputing = false;
    });

    // Create a callback to handle a error events
    node.childProcess.on('error', (err, signal) => {
        RED.log.error("[Face-api.js : " + node.id + " : Child Node]:\n" + err);
        node.isComputing = false
    });

    // Create callback to handle a exit events 
    node.childProcess.on('exit', (code, signal) => {
        const exitString = "[Face-api.js : " + node.id + " : Child Node] - child_process exited with " + `code ${code} and signal ${signal}`
        if (signal == "SIGINT") RED.log.info(exitString)
        else RED.log.error(exitString);
        node.isComputing = false
    });

    // Create the stderr callback for errors that occur in the child node
    node.childProcess.stderr.on('data', (data) => {
        // Convert buffer to string 
        try {
            errMsg = JSON.parse(data)
            RED.log.error("[Face-api.js : " + node.id + " : Child Node]:\n" + errMsg);
            if (node.msgCallback) node.msgCallback(msg);
        }
        catch (err) {
            // cast the Error to a string
            const errString = data.toString()

            // Create a list of known errors
            let ignoredErrors = [
                "Hi there",
                "cpu backend was already",
                "Platform node has already",
                "I tensorfl",
                "Your CPU supports instructions"
            ]

            // Search the incoming error string for known errors 
            for (i = 0; i < ignoredErrors.length; i++) {
                if (errString.indexOf(ignoredErrors[i]) !== -1) {
                    return;
                }
            }

            // If the error is not known print it out
            RED.log.error(errString)
        }
    });
}
else if (!node.childHost && node.childProcess) {
    if (node.childProcess) {
        node.childProcess.kill('SIGINT');
    }
}

node.check_descriptors = async function () {
    return new Promise(async function (resolve, reject) {
        // Check if the dir and file exist
        fs.exists(node._filename).then(() => {
            resolve();
        }).catch((err) => {
            reject(err);
        });
    });
}

node.load_descriptors = async function () {
    return new Promise(async function (resolve, reject) {
        try {
            // Check if the dir and file exist
            if (fs.existsSync(fileName)) {
                // Get the contents
                const fileContents = JSON.parse(fs.readFileSync(fileName, "UTF8"))

                if (fileContents && typeof fileContents === 'object' && fileContents.constructor === Array) {
                    RED.log.info("[Face-api.js : " + node.id + "] - Creating descriptor from file for \"" + node.name + "\"")
                    imageBuffers = []
                    fileContents.forEach((image) => {
                        imageBuffers.push(Buffer.from(image.data))
                    })
                    await node.createDescriptor(imageBuffers)
                }
                else if (fileContents && typeof fileContents === 'object' && fileContents.constructor === Object && "label" in fileContents) {
                    let nameDescriptor = node.labelName || fileContents.label || "known"
                    let floatDescriptor = []

                    // Add each descriptor to an array to add to constructor
                    fileContents.descriptors.forEach(function (array) {
                        floatDescriptor.push(new Float32Array(array))
                    })

                    // Create a new descriptor for the node
                    node.descriptors = new faceapi.LabeledFaceDescriptors(nameDescriptor, floatDescriptor)

                    // Debug 
                    RED.log.info("[Face-api.js : " + node.id + "] - Loaded descriptors for \"" + node.name + "\"")
                }
            }
            else {
                const errorMsg = "[Face-api.js : " + node.id + "] - Descriptor file for \"" + node.name + "\" does not exist"
                RED.log.info(errorMsg)
            }
        }
        catch (error) {
            // Log error
            const errorMsg = "[Face-api.js : " + node.id + "] - Could not load descriptors for \"" + node.name + "\" : \n" + error
            RED.log.warn(errorMsg)
            reject(error);
        }
    });
}

node.createDescriptor = async function (inputBuffers) {
    if (faceApiModelsLoaded) {
        // Get  a descriptor for each input 
        new Promise((resolve, reject) => {
            var results = []
            inputBuffers.forEach(async function (inputBuffer, index, array) {
                try {
                    // Turn the image into a Canvas
                    const img = new Image
                    img.src = inputBuffer

                    // Make a forward pass of each network for the detections
                    const detections = await faceapi.detectSingleFace(img)
                        .withFaceLandmarks()
                        .withFaceDescriptor()

                    if (detections) results.push(detections.descriptor)
                    else {
                        // Log error
                        const errorMsg = "[Face-api.js : " + node.id + "] - No faces detected in given descriptor image for \"" + node.name + "\""
                        RED.log.warn(errorMsg)
                    }

                    if (index === array.length - 1) resolve(results);
                }
                catch (error) {
                    // Log error
                    const errorMsg = "[Face-api.js : " + node.id + "] - Could not create a descriptor for \"" + node.name + ": \n" + error
                    RED.log.warn(errorMsg)
                    reject(errorMsg)
                }
            })
        }).then((descriptors) => {
            if (Array.isArray(descriptors) && descriptors.length) {
                // Get a descriptor for each face
                node.descriptors = new faceapi.LabeledFaceDescriptors(
                    node.labelName,
                    descriptors
                )

                // Write the face descriptor for the specific node to disk
                const saveDir = `${__dirname}/descriptors`;
                const fileName = saveDir + "/" + node.id + ".json"
                if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
                fs.writeFileSync(fileName, JSON.stringify(node.descriptors))

                // Debug
                RED.log.info("[Face-api.js : " + node.id + "] - Saved descriptor for \"" + node.name + "\"")
            }
            else {
                // Log error
                const errorMsg = "[Face-api.js : " + node.id + "] - No faces detected in uploaded images for \"" + node.name + "\""
                RED.log.warn(errorMsg)
            }
        })
    }
}

node.deleteDescriptor = async function () {
    try {
        // Delete the descriptor file 
        const fileName = `${__dirname}/descriptors/` + node.id + ".json"
        if (fs.existsSync(fileName)) {
            fs.unlinkSync(fileName)
            return true
        }
        else {
            return false
        }
    }
    catch (error) {
        // Log error
        const errorMsg = "[Face-api.js : " + node.id + "] - Could not clean up node with name \"" + node.name + ": \n" + error
        RED.log.warn(errorMsg)
        return false
    }
}

node.compute = async function (inputBuffer, callback) {
    const computeDebug = function (type, msg, externalCallback) {
        const outputMsg = "[Face-api.js : " + node.id + "] - " + msg
        if (type === "info") {
            RED.log.info(outputMsg)
            if (externalCallback) externalCallback({ "info": msg })
        }
        else if (type === "warn") {
            RED.log.warn(outputMsg)
            if (externalCallback) externalCallback({ "warn": msg })
            node.isComputing = false;
        }
        else if (type === "error") {
            RED.log.error(outputMsg)
            if (externalCallback) externalCallback({ "error": msg })
            node.isComputing = false;
        }
    }

    // Debug
    // computeDebug("info", "Computing input on node \"" + node.name + "\"", callback)

    // Check if the inputBuffer is a Buffer
    if (!Buffer.isBuffer(inputBuffer)) {
        const errorMsg = "Input was not a Buffer"
        computeDebug("warn", errorMsg, callback)
        return;
    }

    // Set the compute node boolean to true 
    node.isComputing = true;

    // Pass to the child process if it exists
    if (node.childHost && node.childProcess) {
        // Pass to the child process for the node
        node.childProcess.send({ "node": node, "image": inputBuffer });
        node.msgCallback = callback;
    }
    else {
        if (faceApiModelsLoaded) {
            try {
                // Capture time for inference debug
                const startTime = Date.now()

                // Turn the image into a Canvas
                const img = new Image;
                img.onload = async function () {
                    // // Set up the network options
                    let options
                    if (node.recognitionType === "SSD") options = new faceapi.SsdMobilenetv1Options({ minConfidence: node.confidence })
                    else if (node.recognitionType === "Yolo") options = new faceapi.TinyFaceDetectorOptions({ scoreThreshold: node.confidence, inputSize: node.inputSize })

                    // Make a forward pass of each network for the detections
                    let detections = null
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
                            computeDebug("warn", errorMsg, callback)
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
                            computeDebug("warn", errorMsg, callback)
                        }

                        if (detections === undefined) detections = []
                        else detections = [detections]
                    }

                    // Check if there are ny detections
                    if (detections && typeof detections === 'object' && detections.constructor === Array) {
                        // If recognition is required, check against comparator
                        if (node.recognition && node.descriptors) {
                            let nameDescriptor = node.labelName || fileContents.label || "known"
                            let floatDescriptor = []

                            // Add each descriptor to an array to add to constructor
                            node.descriptors.descriptors.forEach(function (array) {
                                floatDescriptor.push(new Float32Array(array))
                            })

                            // Create a new descriptor for the node 
                            const descriptor = new faceapi.LabeledFaceDescriptors(nameDescriptor, floatDescriptor)
                            const faceMatcher = new faceapi.FaceMatcher(descriptor)

                            // Check if one or multiple faces require matching
                            detections.forEach(face => {
                                let bestDistance = null;
                                const inputDescriptor = Array.prototype.slice.call(face.descriptor)

                                // Loop the provided descriptors to compare against the input descriptor
                                node.descriptors.descriptors.forEach((baseDescriptor) => {
                                    // Create currentDistance to hold value for node iteration
                                    let currentDistance = null;

                                    // Find best match for the chosen distance metric
                                    if (node.recognitionMetric === "Euclidean") {   // Smaller is better 
                                        const euclideanDistance = require('euclidean')
                                        currentDistance = Math.round(euclideanDistance(baseDescriptor, inputDescriptor) * 10000)
                                    }
                                    else if (node.recognitionMetric === "Manhattan") {  // Smaller is better 
                                        const manhattanDistance = require('manhattan')
                                        currentDistance = Math.round(manhattanDistance(baseDescriptor, inputDescriptor) * 1000)
                                    }
                                    else if (node.recognitionMetric === "Chebyshev") {  // Smaller is better 
                                        const chebyshevDistance = require('chebyshev')
                                        currentDistance = Math.round(chebyshevDistance(baseDescriptor, inputDescriptor) * 100000)
                                    }
                                    else if (node.recognitionMetric === "Mean Squared Error") { // Smaller is better
                                        let sum = 0;
                                        for (i = 0; i < inputDescriptor.length; i += 1) {
                                            var error = inputDescriptor[i] - baseDescriptor[i];
                                            sum += error * error;
                                        }
                                        currentDistance = Math.round(sum / inputDescriptor.length * 1000000)
                                    }

                                    // Compare to the best distance found 
                                    if (bestDistance == null) bestDistance = currentDistance
                                    else if (bestDistance > currentDistance) bestDistance = currentDistance
                                })

                                // Check if the best distance found is below the threshold
                                face.bestMatch = {
                                    _distance: bestDistance,
                                    _metric: node.recognitionMetric,
                                    _label: (node.recognitionConfidence > bestDistance) ? node.descriptors.label : "unknown"
                                }
                            })
                        }
                        else if (node.recognition && !node.descriptors) {
                            // Log error
                            const errorMsg = "Recognition is selected but there was no descriptor to compare against, please select an image to create a descriptor."
                            computeDebug("warn", errorMsg, callback)
                        }

                        // Draw the information on the image
                        const drawImage = async function (img, detections) {
                            // Draw the detection rectangle
                            const outImg = faceapi.createCanvasFromMedia(img)

                            // Draw the main box
                            faceapi.draw.drawDetections(outImg, detections)

                            // Draw the landmarks if required
                            if (node.landmarks) faceapi.draw.drawFaceLandmarks(outImg, detections)

                            // Draw the other optional data
                            detections.forEach(result => {
                                // Make label for experssion
                                const { expressions } = result
                                let expressionMaxKey = (node.expressions && expressions) ? Object.keys(expressions).reduce(function (a, b) {
                                    return expressions[a] > expressions[b] ? a : b
                                }) : null
                                const expressionsLabel = (node.expressions) ? [
                                    `${expressionMaxKey} : ${faceapi.round(expressions[expressionMaxKey] * 100, 0)}%`
                                ] : []
                                // console.log(expressionsLabel)

                                // Make label for age and gender
                                const { age, gender, genderProbability } = result
                                const ageGenderLabel = (node.ageGender && age && gender && genderProbability) ? [
                                    `${gender} : ${faceapi.round(genderProbability * 100)}%`,
                                    `${faceapi.round(age, 0)} years`
                                ] : []
                                // console.log(ageGenderLabel)

                                // Add the face recognition confidence
                                const { bestMatch } = result
                                const recognitionLabel = (node.recognition && bestMatch) ? [
                                    `${bestMatch["_label"]} (${faceapi.round(bestMatch["_distance"], 2)})`,
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
                        msg["faces"] = []
                        msg["name"] = node.name
                        msg["image"] = newImg
                        msg["inferenceTime"] = Date.now() - startTime
                        detections.forEach(result => {
                            // Get the info of the base detection
                            const { detection } = result
                            const FaceDetection = (detection) ? {
                                "imageDims": detection._imageDims,
                                "score": detection._score,
                                "classScore": detection._classScore,
                                "className": detection._className
                            } : {
                                "imageDims": result._imageDims,
                                "score": result._score,
                                "classScore": result._classScore,
                                "className": result._className
                            }

                            // Get the landmarks
                            const { landmarks, unshiftedLandmarks, alignedRect } = result
                            const FacialLandmarks = (node.landmarks && landmarks && unshiftedLandmarks) ? {
                                "landmarks": {
                                    "_imageDims": landmarks._imageDims,
                                    "_shift": landmarks._shift,
                                    "_positions": landmarks._positions
                                },
                                "unshiftedLandmarks": {
                                    "_imageDims": unshiftedLandmarks._imageDims,
                                    "_shift": unshiftedLandmarks._shift,
                                    "_positions": unshiftedLandmarks._positions
                                },
                                "alignedRect": {
                                    "_imageDims": alignedRect._imageDims,
                                    "_score": alignedRect._score,
                                    "_classScore": alignedRect._classScore,
                                    "_className": alignedRect._className,
                                    "_box": alignedRect._box,
                                }
                            } : null

                            // Get the expressions and calculate the max score
                            const { expressions } = result
                            let expressionMaxKey = (node.expressions && expressions) ? Object.keys(expressions).reduce(function (a, b) {
                                return expressions[a] > expressions[b] ? a : b
                            }) : null
                            const FacialExpressions = (expressions) ? {
                                "expressionLabel": expressionMaxKey,
                                "expressionScore": expressions[expressionMaxKey],
                                "expressions": {
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
                                "gender": gender,
                                "age": age,
                                "genderProbability": genderProbability
                            } : null

                            // Get the Face recognition scores
                            const { bestMatch, descriptor } = result
                            const BestMatch = (node.recognition && bestMatch && descriptor) ? {
                                "matchedLabel": bestMatch._label,
                                "matchedDistance": bestMatch._distance,
                                "matchedMetric": bestMatch._metric,
                                "descriptor": descriptor
                            } : null

                            // Concat the objects to create output message
                            msg.faces.push({
                                ...FaceDetection,
                                ...FacialLandmarks,
                                ...FacialExpressions,
                                ...AgeAndGender,
                                ...BestMatch
                            })
                        })

                        // Callback with the new message
                        callback(msg)
                        node.isComputing = false;
                    }
                    else if (detections && typeof detections === 'object' && detections.constructor === Array && detections.length == 0) {
                        let msg = {}
                        msg["faces"] = []
                        msg["name"] = node.name
                        msg["image"] = inputBuffer
                        msg["inferenceTime"] = Date.now() - startTime
                        callback(msg)
                        node.isComputing = false;
                    }
                    else {
                        // Log error
                        const errorMsg = "No detections found for input"
                        computeDebug("warn", errorMsg, callback)
                    }
                };
                img.onerror = err => {
                    const errorMsg = "Failed to load input image into Canvas";
                    computeDebug("error", errorMsg, callback)
                };
                img.src = inputBuffer;
            }
            catch (error) {
                // Log error
                const errorMsg = "Error computing detections: " + error
                computeDebug("error", errorMsg, callback)
            }
        }
        else {
            // Log error
            const errorMsg = "Models not loaded"
            computeDebug("warn", errorMsg, callback)
        }
    }
}

node.clean = async function () {
    // Debug 
    RED.log.info("[Face-api.js : " + node.id + "] - Clenaing up node \"" + node.name + "\"")

    // Delete the save file
    node.deleteDescriptor()
}

node.on('close', async function (removed, done) {
    if (removed) {
        // Clean up models
        node.clean()
    }

    // kill the child process
    if (node.childProcess) {
        node.childProcess.kill('SIGINT');
    }

    // Callback to end function
    done()
})

// Start the node by loading the descriptor
node.loadDescriptor();