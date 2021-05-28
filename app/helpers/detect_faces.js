// Import Canvas and face-api.js
const canvas = require('canvas');
const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Import Helpers
const { isObject, isType } = require('./type_checks');

// Export main function
module.exports = async function (model_options, detect_options, img) {
    return new Promise(async function (resolve, reject) {
        try {
            // Ensure that the img and options are valid
            if (isType(img, Canvas)) {
                let detections = [];

                // Check the model_options are valid or use a default
                if (!(isType(model_options, faceapi.SsdMobilenetv1Options) || !isType(model_options, faceapi.TinyFaceDetectorOptions))) {
                    model_options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 });
                }

                // Check detect_options are valid else set to default
                if (!isObject(detect_options)) {
                    detect_options = {
                        'landmarks': false,
                        'expressions': false,
                        'age_gender': false,
                        'descriptors': true
                    }
                }

                // If descriptors are requested, landmarks are required
                detect_options.landmarks = (detect_options.descriptors) ? true : detect_options.landmarks;

                // Face detection only
                if (!detect_options.landmarks && !detect_options.expressions && !detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options);
                }

                // Face detection with either landmarks, expressions, AAG, or descriptors
                else if (detect_options.landmarks && !detect_options.expressions && !detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks();
                }
                else if (!detect_options.landmarks && detect_options.expressions && !detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceExpressions();
                }
                else if (!detect_options.landmarks && !detect_options.expressions && detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withAgeAndGender();
                }
                else if (!detect_options.landmarks && !detect_options.expressions && !detect_options.age_gender && detect_options.descriptors) {
                    // invalid without landmarks
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withFaceDescriptors();
                }

                // Face detection with landmarks and either expressions, AAG, or descriptors
                else if (detect_options.landmarks && detect_options.expressions && !detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withFaceExpressions();
                }
                else if (detect_options.landmarks && !detect_options.expressions && detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withAgeAndGender();
                }
                else if (detect_options.landmarks && !detect_options.expressions && !detect_options.age_gender && detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withFaceDescriptors();
                }

                // Face detection with landmarks and expressions with either AAG, or descriptors
                else if (detect_options.landmarks && detect_options.expressions && detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withFaceExpressions().withAgeAndGender();
                }
                else if (detect_options.landmarks && detect_options.expressions && !detect_options.age_gender && detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
                }

                // Face detection with landmarks, AAG, and descriptors, but not expressions
                else if (detect_options.landmarks && !detect_options.expressions && detect_options.age_gender && detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withAgeAndGender().withFaceDescriptors();
                }

                // Face detection wihout landmarks or descriptors but with expressions and age and gender
                else if (!detect_options.landmarks && detect_options.expressions && detect_options.age_gender && !detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceExpressions().withAgeAndGender();
                }

                // All possible options
                else if (detect_options.landmarks && detect_options.expressions && detect_options.age_gender && detect_options.descriptors) {
                    detections = await faceapi.detectAllFaces(img, model_options).withFaceLandmarks().withFaceExpressions().withAgeAndGender().withFaceDescriptors()
                }

                // Else not supported
                else {
                    reject(detections);
                }

                // If the detection worked, resolve with detections
                resolve(detections);
            }
            else {
                throw 'Image object passed was not a Canvas object';
            }
        }
        catch (err) {
            reject(err);
        }
    });
}