// Import Canvas and face-api.js
const canvas = require('canvas');
const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData })

// Import Helpers
const { isObject } = require('./type_checks');

// Export main function
module.exports = async function (detection_options, detections, img) {
    return new Promise(async function (resolve, reject) {
        try {
            // Check img is a canvas object or detections are valid or detection_options are valid
            if (!img instanceof Canvas || !isObject(detection_options)) {
                reject();
            }
            else if (!detections.length) {
                resolve(img);
            }
            else {
                // Draw Rectangle around face as default
                faceapi.draw.drawDetections(img, detections);

                // Draw Landmarks if required
                if (detection_options.landmarks) faceapi.draw.drawFaceLandmarks(img, detections);

                // Loop each face for the other types of detection
                detections.forEach(face => {
                    try {
                        // Draw age and gender if required
                        const { age, gender, genderProbability } = face
                        const age_gender_label = (detection_options.age_gender && age && gender && genderProbability) ? [
                            `${gender} : ${Math.round(genderProbability * 100, 0)}%`,
                            `${Math.round(age, 0)} years`
                        ] : []

                        // Draw expersions if required
                        const { expressions } = face;
                        const expressionMaxKey = (detection_options.expressions && expressions) ? Object.keys(expressions).reduce(function (a, b) {
                            return expressions[a] > expressions[b] ? a : b
                        }) : null
                        const expressions_label = (detection_options.expressions && expressions && expressionMaxKey) ? [
                            `${expressionMaxKey} : ${Math.round(expressions[expressionMaxKey] * 100, 0)}%`
                        ] : []

                        // Draw recognised face names and confidence value if required
                        const { name, distance } = face;
                        const matched_face_label = (name && distance) ? [
                            `${name} (${Math.round(distance * 100, 2) / 100})`
                        ] : [];

                        // Concat the labels and draw them on the face
                        if (age_gender_label.length || expressions_label.length || matched_face_label.length)
                            new faceapi.draw.DrawTextField(
                                [
                                    ...age_gender_label,
                                    ...expressions_label,
                                    ...matched_face_label
                                ],
                                face.detection.box.bottomLeft
                            ).draw(img);
                    }
                    catch (err) {
                        reject(err);
                    }
                });

                // Return image
                resolve(img);
            }
        }
        catch (err) {
            reject(err);
        }
    });
}