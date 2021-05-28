// Export main function
module.exports = async function (RED, id) {
    return new Promise(async function (resolve, reject) {
        try {
            let node = RED.nodes.getNode(id).delete_descriptor().then(() => {
               resolve(201); 
            }).catch(() => {
                reject(400);
            });   
        }
        catch (err) {
            reject(404);
        }
    });
}