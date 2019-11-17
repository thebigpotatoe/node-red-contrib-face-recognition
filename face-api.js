module.exports = function (RED) {
    // Import the required modules
    let canvas      = require('canvas');
    let faceapi     = require('face-api.js');
    let fs          = require("fs");
    let formidable  = require('formidable');

    // Try load in Tfjs-node if it is installed
    try {
        require('@tensorflow/tfjs-node');
    }
    catch (e) {
        if (e instanceof Error && e.code === "MODULE_NOT_FOUND")
            RED.log.info("[Face-api.js] - TensorFlow.js for Node.js was not found, running without it");
        else
            throw e;
    }

    // Monkey patch nodejs to faceapi with canvas
    const { Canvas, Image, ImageData } = canvas
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData })
    let faceApiModelsLoaded = false

    // Load the models in at startup
    async function loadModels() {
        RED.log.info("[Face-api.js] - Loading Models", "info")
        try {
            const modelPath = `${__dirname}/weights`;
            const ssdMobilenetv1Method          = faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath)
            const tinyFaceDetectorMethod        = faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath)
            const faceLandmark68NetMethod       = faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath)
            const faceLandmark68TinyNetMethod   = faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelPath)
            const faceExpressionNetMethod       = faceapi.nets.faceExpressionNet.loadFromDisk(modelPath)
            const ageGenderNetMethod            = faceapi.nets.ageGenderNet.loadFromDisk(modelPath)
            const faceRecognitionNetMethod      = faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)

            await ssdMobilenetv1Method
            await tinyFaceDetectorMethod
            await faceLandmark68NetMethod
            await faceLandmark68TinyNetMethod
            await faceExpressionNetMethod
            await ageGenderNetMethod
            await faceRecognitionNetMethod

            faceApiModelsLoaded = true
            RED.log.info("[Face-api.js] - Models Loaded")
        }
        catch (error) {
            RED.log.warn("[Face-api.js] - Models failed to load: \n" + error)
        }
    }
    loadModels()

    // Create a descriptor file path if it does not exist
    async function checkDescriptorDir() {
        const saveDir = `${__dirname}/descriptors`;
        if (!fs.existsSync(saveDir)){
            fs.mkdirSync(saveDir);
            RED.log.info("[Face-a-pi.js] - Created descriptors directory at " + saveDir)
        }
    }
    checkDescriptorDir()

    // Input Node constructor
    function faceApiInputNode(config) {
        // Register node with node red
        RED.nodes.createNode(this, config);
        var node = this;

        // Set the initial status of the node
        this.status({fill:"green",shape:"dot",text:"ready"});

        // Get the facec API config node 
        this.computeNode = RED.nodes.getNode(config.computeNode);
        
        // message input handle
        node.on('input', async function (msg, send, done) {
            // Set the status to computing
            this.status({fill:"blue",shape:"dot",text:"computing"});

            // Check if node is already busy
            if (!this.computeNode.isComputing) {
                // Check if compute node is selected
                if (this.computeNode) {
                    // Check Payload Exists 
                    if ("payload" in msg) {
                        // Check if Payload was a buffer
                        if (Buffer.isBuffer(msg.payload)) {
                            // Create the callback for a new msg from the compute node
                            await this.computeNode.compute(msg.payload, (output) => {
                                // Check if error 
                                if ("error" in output || "warn" in output) {
                                    // Set the status to error
                                    this.status({fill:"red",shape:"dot",text:"Error in compute node"});
                                }
                                else if ("info" in output) {
                                    // ignore message with info 
                                }
                                else {
                                    // Set Status back to ready
                                    this.status({fill:"green",shape:"dot",text:"ready"});

                                    // Send the message
                                    send = send || function() { node.send.apply(node,arguments); };
                                    send(output);
                                }
                            });
                        }
                        else {
                            this.status({fill:"red",shape:"dot",text:"msg.payload was not a buffer"});
                            RED.log.warn("[Face-api.js] - msg.payload was not a buffer, ignoring")
                        }
                    }
                    else {
                        this.status({fill:"red",shape:"dot",text:"No msg.payload found"});
                        RED.log.warn("[Face-api.js] - No msg.payload found")
                    }
                }
                else {
                    this.status({fill:"red",shape:"dot",text:"No compute node selected"});
                    RED.log.warn("[Face-api.js] - No compute node selected for " + this.name)
                }
            }
        });
    }
    RED.nodes.registerType("face-api-input", faceApiInputNode);
    
    // Compute Node Constructor
    function faceApiComputeNode(config) {
        // Register node with node red
        RED.nodes.createNode(this, config);
        let node = this;
        
        // Node variables 
        node.name                   = config.name                   || "face-api-compute";
        node.childHost              = config.childHost              || false;
        node.labelName              = config.labelName              || "known";
        node.recognitionType        = config.recognitionType        || "SSD";
        node.multipleFaces          = config.multipleFaces          || "Multiple Faces";
        node.confidence             = config.confidence/100         || 0.5;
        node.inputSize              = parseInt(config.inputSize)    || 416;
        node.landmarks              = config.landmarks              || false;
        node.expressions            = config.expressions            || false;
        node.ageGender              = config.ageGender              || false;
        node.recognition            = config.recognition            || false;
        node.descriptors            = null;
        node.modelsLoaded           = false;
        node.labelledDescriptors    = null;
        node.msgCallback            = null;
        node.isComputing            = false;
        
        // Start the child node if required or kill it
        if (node.childHost) {  
            // Set up args and options for the child 
            const args = [];  
            const options = {stdio : "pipe"};

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
                RED.log.info("[Face-api.js : " + node.id + " : Child Node] - child_process exited with " + `code ${code} and signal ${signal}`);
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
                    const errString = data.toString()
                    if (errString.charAt(1) !== '=') RED.log.error(errString)
                }
            });
        }
        else if (!node.childHost && node.childProcess) {
            if (node.childProcess) {
                node.childProcess.kill('SIGINT');
            }
        }

        node.loadDescriptor = async function () {
            try {
                // Check if the dir and file exist
                const fileName = `${__dirname}/descriptors/` + node.id + ".json"
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
                        let nameDescriptor      = node.labelName || fileContents.label || "known"
                        let floatDescriptor     = []

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
            }
        }

        node.createDescriptor = async function (inputBuffers) {
            if (faceApiModelsLoaded) {
                // Get  a descriptor for each input 
                new Promise((resolve, reject) => {
                    var results = []
                    inputBuffers.forEach(async function (inputBuffer, index, array) {
                        try {
                            // Turn the image into a Canvas
                            const img   = new Image
                            img.src     = inputBuffer

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

                            if (index === array.length -1) resolve(results);
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

        node.compute = async function(inputBuffer, callback) {
            const computeDebug = function (type, msg, externalCallback) {
                const outputMsg = "[Face-api.js : " + node.id + "] - " + msg
                if (type === "info") {
                    RED.log.info(outputMsg)
                    if (externalCallback) externalCallback( { "info" : msg} )
                }
                else if (type === "warn") {
                    RED.log.warn(outputMsg)
                    if (externalCallback) externalCallback( { "warn" : msg} )
                    node.isComputing = false;
                }
                else if (type === "error") {
                    RED.log.error(outputMsg)
                    if (externalCallback) externalCallback( { "error" : msg} )
                    node.isComputing = false;
                }
            }

            // Check if the inputBuffer is a Buffer
            if (!Buffer.isBuffer(inputBuffer)){
                const errorMsg = "Input was not a Buffer"
                computeDebug("warn", errorMsg, callback)
                return;
            }

            // Set the compute node boolean to true 
            node.isComputing = true;

            // Pass to the child process if it exists
            if (node.childHost && node.childProcess) {
                // Pass to the child process for the node
                node.childProcess.send({"node" : node, "image": inputBuffer });  
                node.msgCallback =  callback;
            }
            else {
                if (faceApiModelsLoaded) {
                    try {
                        // Debug
                        computeDebug("info", "Computing input on node \"" + node.name + "\"", callback)
                        const startTime = Date.now()

                        // Turn the image into a Canvas
                        const img   = new Image;
                        img.onload 	= async function () { 
                            // // Set up the network options
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
                                    computeDebug("warn", errorMsg, callback)
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
                                callback( msg )
                                node.isComputing = false;
                            }
                            else if (detections && typeof detections === 'object' && detections.constructor === Array && detections.length == 0) {
                                let msg = {}
                                msg["payload"]          = []
                                msg["image"]            = inputBuffer
                                msg["inferenceTime"]    = Date.now() - startTime
                                callback( msg )
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
                        img.src     = inputBuffer;
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

        node.clean = async function() {
            // Debug 
            RED.log.info("[Face-api.js : " + node.id + "] - Clenaing up node \"" + node.name + "\"")

            // Delete the save file
            node.deleteDescriptor()
        }

        node.on('close', async function(removed, done) {
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
    }
    RED.nodes.registerType("face-api-compute", faceApiComputeNode);

    // HTTP Endpoints for use with the front end
    RED.httpAdmin.post('/faceapi/:id', RED.auth.needsPermission('face-api-compute.upload'), function(req,res) {
        // Get the important stuff
        var node = RED.nodes.getNode(req.params.id);
        var form = new formidable.IncomingForm();

        // not ideal, shouldnt have to write to disk but is only every so often
        form.parse(req, function (err, fields, files) {
            if (form.openedFiles.length > 0) {
                // Get each of the files data and put into an array 
                var filesArray = []
                Object.keys(files).forEach((number) => {
                    const fileContents = fs.readFileSync(files[number].path)
                    filesArray.push(fileContents)
                });

                // Save the files or create a descriptor
                if (node) {
                    // If the node exists then create a descriptor right away 
                    node.createDescriptor(filesArray)
                    res.status(201).send('OK').end();
                }
                else {
                    // If the node has not been depolyed, save the image and load it when deployed
                    const saveDir = `${__dirname}/descriptors`;
                    const fileName = saveDir + "/" + req.params.id + ".json"
                    fs.writeFileSync(fileName, JSON.stringify(filesArray))
                    res.status(202).send('OK').end();
                }
            }
            else {
                res.status(400).send("No files sent with request").end();
            }
        });
    });
    RED.httpAdmin.get('/faceapi/:id/check', RED.auth.needsPermission('face-api-compute.upload'), async function(req,res) {
        // Get the important stuff
        var node = RED.nodes.getNode(req.params.id);

        // Respond to the front end
        if (node) {
            const fileName = `${__dirname}/descriptors/` + node.id + ".json"
            if (fs.existsSync(fileName)) { 
                const fileData = JSON.parse(fs.readFileSync(fileName))
                res.status(200).send(fileData.descriptors.length.toString()).end();
            }
            else {
                res.status(200).send("0").end();
            }
        }
        else {
            res.send("No node found matching " + req.params.id).status(400).end();
        }
    });
    RED.httpAdmin.get('/faceapi/:id/delete', RED.auth.needsPermission('face-api-compute.upload'), async function(req,res) {
        // Get the important stuff
        var node = RED.nodes.getNode(req.params.id);

        // Delete the descriptors and respond to the front end
        if (node) {
            if (await node.deleteDescriptor()) {
                res.status(201).send('OK').end();
            }
            else {
                res.status(404).send('OK').end();
            }
        }
        else {
            res.send("No node found matching " + req.params.id).status(400).end();
        }
    });
}