// isString
module.exports.isString = function (value) {
    return typeof value === 'string' || value instanceof String;
}

// isNumber
module.exports.isNumber = function (value) {
    return typeof value === 'number' && isFinite(value);
}

// isArray
module.exports.isArray = function (value) {
    return value && typeof value === 'object' && value.constructor === Array;
}

// isFunction
module.exports.isFunction = function (value) {
    return typeof value === 'function';
}

// isObject
module.exports.isObject = function (value) {
    return value && typeof value === 'object' && value.constructor === Object;
}

// isNull
module.exports.isNull = function (value) {
    return value === null;
}

// isUndefined
module.exports.isUndefined = function (value) {
    return typeof value === 'undefined';
}

// isBoolean
module.exports.isBoolean = function (value) {
    return typeof value === 'boolean';
}

// isRegExp
module.exports.isRegExp = function (value) {
    return value && typeof value === 'object' && value.constructor === RegExp;
}

// isError
module.exports.isError = function (value) {
    return value instanceof Error && typeof value.message !== 'undefined';
}

// isDate
module.exports.isDate = function (value) {
    return value instanceof Date;
}

// isSymbol
module.exports.isSymbol = function (value) {
    return typeof value === 'symbol';
}

// isType
module.exports.isType = function (value, type) {
    return value && value instanceof type;
}