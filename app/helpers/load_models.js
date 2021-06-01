// Import Canvas, tensorflow, and face-api.js
const fs = require('fs');
const canvas = require('canvas');
const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData })

// Export main function
module.exports = async function (weights_path, cb) {
    return new Promise(async function (resolve, reject) {
        try {
            // Start to load the models
            const ssdMobilenetv1Method          = faceapi.nets.ssdMobilenetv1.loadFromDisk(weights_path);
            const tinyFaceDetectorMethod        = faceapi.nets.tinyFaceDetector.loadFromDisk(weights_path);
            const faceLandmark68NetMethod       = faceapi.nets.faceLandmark68Net.loadFromDisk(weights_path);
            const faceLandmark68TinyNetMethod   = faceapi.nets.faceLandmark68TinyNet.loadFromDisk(weights_path);
            const faceExpressionNetMethod       = faceapi.nets.faceExpressionNet.loadFromDisk(weights_path);
            const ageGenderNetMethod            = faceapi.nets.ageGenderNet.loadFromDisk(weights_path);
            const faceRecognitionNetMethod      = faceapi.nets.faceRecognitionNet.loadFromDisk(weights_path);

            // Wait for models to load
            await ssdMobilenetv1Method;
            await tinyFaceDetectorMethod;
            await faceLandmark68NetMethod;
            await faceLandmark68TinyNetMethod;
            await faceExpressionNetMethod;
            await ageGenderNetMethod;
            await faceRecognitionNetMethod;

            // Return true when done
            resolve(true);
        }
        catch (err) {
            reject(err);
        }
    });
}
