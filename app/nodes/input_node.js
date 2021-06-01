// Import required modules
const { join } = require('path')
const { fork } = require('child_process');
const detect_on_fork = require("../helpers/detect_on_fork");
const { isNull } = require('../helpers/type_checks');

// Input Node constructor
module.exports = function (RED, config, node) {
    // Register the node with node red
    RED.nodes.createNode(node, config);

    // Node specific variables
    node.RED = RED;
    node._busy = false;
    node.child = null;
    node.match_confidence = parseInt(config.match_confidence) || 2000;
    node.match_metric = config.match_metric || "Mean Squared Error";

    // Get the model and detection parameters from config
    node.model_options = {
        "model": config.model,
        "minConfidence": Math.min(Math.max(parseInt(config.confidence) / 100, 0), 1),
        "inputSize": parseInt(config.input_size),
        "maxResults": 100
    };
    node.detect_options = {
        "landmarks": config.landmarks,
        "age_gender": config.age_gender,
        "expressions": config.expressions,
        "descriptors": config.descriptors
    };

    // Register all compute nodes into an array
    node.recognise_nodes = config.recognise_nodes;

    // Set the initial status of the node
    node.status({ fill: "green", shape: "dot", text: "ready" });

    // Create the supporting functions
    node._set_status = function (level, colour, msg) {
        return new Promise((resolve, reject) => {
            let prefix = "[face-api-input:" + node.id + "] - ";
            switch (level) {
                case "error":
                    node.status({ fill: colour, shape: "dot", text: msg });
                    node.RED.log.error(prefix + msg);
                    break;
                case "warn":
                    node.status({ fill: colour, shape: "dot", text: msg });
                    node.RED.log.warn(prefix + msg);
                    break;

                case "info":
                    node.status({ fill: colour, shape: "dot", text: msg });
                    node.RED.log.info(prefix + msg);
                    break;

                default:
                    node.status({ fill: "green", shape: "dot", text: "ready" });
                    node.RED.log.debug(prefix + "Node Ready");
                    break;
            }

            resolve();
        });
    }
    node._is_busy = function () {
        return new Promise((resolve, reject) => {
            (node._busy) ? reject("Node is busy") : resolve();
        });
    }
    node._set_busy = function (state) {
        return new Promise((resolve, reject) => {
            // node._busy = state;
            node._busy = false;
            (state) ? node._set_status("info", "blue", "Computing...") : node._set_status("info", "green", "Ready");
            resolve();
        });
    }
    node._check_recognise_nodes = function () {
        return new Promise((resolve, reject) => {
            if (node.recognise_nodes.every(element => element === null)) {
                reject("No compute nodes selected");
            }
            else {
                resolve();
            }
        });
    }
    node._check_payload = function (msg) {
        return new Promise((resolve, reject) => {
            if (!("payload" in msg)) {
                reject("No msg.payload found");
            }
            else if (!Buffer.isBuffer(msg.payload)) {
                reject("msg.payload was not a buffer");
            }
            else {
                resolve({
                    "image": msg.payload,
                    "model_options": msg.model_options || node.model_options,
                    "detect_options": msg.detect_options || node.detect_options,
                    "metric": msg.metric || node.match_metric,
                    "match_confidence": msg.match_confidence || node.match_confidence
                });
            }
        });
    }
    node._inject_value = function (msg, name, value) {
        return new Promise((resolve, reject) => {
            msg[name] = value;
            resolve(msg);
        });
    }
    node._remove_value = function (name, msg) {
        return new Promise((resolve, reject) => {
            delete msg.name;
            resolve(msg);
        });
    }
    node._prepare_to_send = function (msg) {
        return new Promise((resolve, reject) => {
            resolve({ "payload": msg });
        });
    }
    node._start_inference = function (msg) {
        return new Promise((resolve, reject) => {
            node._is_busy()
                .then(node._set_busy.bind(null, true))
                // .then(node._check_recognise_nodes.bind(null))
                .then(node._check_payload.bind(null, msg))
                .then(resolve)
                .catch(reject);
        });
    }
    node._end_inference = function () {
        return new Promise((resolve, reject) => {
            node._set_busy(false)
                .then(resolve)
                .catch(reject);
        });
    }

    // Create functions for handling child processes
    node._get_recognise_node = function (node_id) {
        return new Promise((resolve, reject) => {
            if (node_id !== null) {
                let recognise_node = RED.nodes.getNode(node_id);
                if (recognise_node !== null) {
                    resolve(recognise_node);
                    return;
                }
            }

            reject("Recognise node " + node_id + "does not exist");
        });
    }
    node._get_comparison_descriptors = function (msg) {
        return Promise.all(node.recognise_nodes.map((id) => {
            return node._get_recognise_node(id)
                .then((recognise_node) => { return recognise_node.get_descriptor(); })
                .then((descriptor) => { return descriptor.toJSON() })
                .catch((err) => { return null; });
        })).then((descriptors) => {
            return descriptors.filter(x => x)
        });
    }
    node._create_fork = function () {
        return new Promise(async function (resolve, reject) {
            // Return the previous child process if it already exists
            if (isNull(node.child)) {
                // Create the child process
                const args = [];
                const options = { stdio: "pipe" };
                node.child = fork(join(__dirname, 'inference_node.js'), args, options);

                // Create a callback to handle a error events
                node.child.on('error', (err, signal) => {
                    node._set_status("error", "red", "Child - " + err);
                    node.child.kill('SIGINT');
                    node.child = null;
                });

                // Create callback to handle a exit events 
                node.child.on('exit', (code, signal) => {
                    node._set_status("warn", "yellow", `Child - child_process exited with code ${code} and signal ${signal}`);
                });

                // Add logging
                node.child.stderr.on('data', (data) => {
                    node.RED.log.debug(data.toString());
                })
            }

            // Always return the child fork
            resolve(node.child);
        });
    }
    node._clean_results = function (msg) {
        return new Promise((resolve, reject) => {
            delete msg.descriptors
            msg.image = Buffer.from(msg.image)
            msg.labelled_img = Buffer.from(msg.labelled_img)
            resolve(msg)
        });
    }
    node._detect_on_fork = function (msg) {
        return new Promise(async function (resolve, reject) {
            node._get_comparison_descriptors(msg)
                .then(node._inject_value.bind(null, msg, "descriptors"))
                .then(node._create_fork)
                .then(detect_on_fork.bind(null, msg))
                .then(node._clean_results)
                .then(resolve);
        });
    }

    // message input handle
    node.on('input', function (msg, send, done) {
        node._start_inference(msg)
            .then(node._detect_on_fork)
            .then(node._prepare_to_send)
            .then(send)
            .then(node._end_inference)
            .catch(node._set_status.bind(null, "error", "red"))
            .finally(done)
    });

    // Clean up the node when closed
    node.on('close', function () {
        if (!isNull(node.child)) node.child.kill('SIGINT');
    });
}