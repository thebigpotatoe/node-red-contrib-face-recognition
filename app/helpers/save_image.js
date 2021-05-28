// Import main modules
const fs = require('fs');
const path = require('path');

// Import Canvas
const canvas = require('canvas');
const { Canvas } = canvas;

// Export main function
module.exports = async function (img, location, name) {
    return new Promise(async function (resolve, reject) {
        try {
            // Check img is a canvas object 
            if (!img instanceof Canvas) throw 'Image object passed was not a Canvas object';
            else {
                // Check if folder exists or create it
                if (!fs.existsSync(location)) fs.mkdirSync(location);

                // Write to img to file
                fs.writeFile(path.join(location, name), img.toBuffer(), (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            }
        }
        catch (err) {
            reject(err);
        }
    });
}