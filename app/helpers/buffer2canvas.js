// Import Canvas and face-api.js
const fs = require('fs');
const canvas = require('canvas');
const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData })

// Export main function
module.exports = async function (buffer) {
    return new Promise(async function (resolve, reject) {
        try {
            let img = new Image;
            img.src = buffer; 
            const canvas_img = faceapi.createCanvasFromMedia(img);
            resolve(canvas_img);
        }
        catch (err) {
            reject(err);
        }
    });
}