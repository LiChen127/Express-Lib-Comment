/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';
/**
 * Layer类
 * 负责处理路由层
 */
/**
 * Module dependencies.
 * @private
 */
/**
 * 路径正则
 */
var pathRegexp = require('path-to-regexp');
var debug = require('debug')('express:router:layer');

/**
 * Module variables.
 * @private
 */
/**
 * 检查对象是否具有属性，从 Object.prototype 继承
 */
var hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Module exports.
 * @public
 */

module.exports = Layer;

function Layer(path, options, fn) {
  /**
   * 如果 this 不是 Layer 的实例，则创建一个新的 Layer 实例
   */
  if (!(this instanceof Layer)) {
    return new Layer(path, options, fn);
  }

  debug('new %o', path)
  var opts = options || {};
  /**
   * 设置 handle
   */
  this.handle = fn;
  /**
   * 设置 name
   */
  this.name = fn.name || '<anonymous>';
  /**
   * 初始化params path regexp
   */
  this.params = undefined;
  this.path = undefined;
  this.regexp = pathRegexp(path, this.keys = [], opts);
  /**
   * 设置 fast path flags
   * 处理 * 和 / 的快速路径
   */
  // set fast path flags
  this.regexp.fast_star = path === '*'
  this.regexp.fast_slash = path === '/' && opts.end === false
}

/**
 * Handle the error for the layer.
 *
 * @param {Error} error
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */
/**
 * 处理错误
 * @param {*} error 错误
 * @param {*} req 请求
 * @param {*} res 响应
 * @param {*} next 下一个中间件
 * @returns
 */
Layer.prototype.handle_error = function handle_error(error, req, res, next) {
  /**
   * this.handle 是路由处理函数
   */
  var fn = this.handle;
  /**
   * 如果 fn 的长度不是 4，则不是标准的错误处理程序
   */
  if (fn.length !== 4) {
    /**
     * 不是标准的错误处理程序
     * next 到 错误处理中间件
     */
    // not a standard error handler
    return next(error);
  }

  try {
    /**
     * 调用路由处理函数
     */
    fn(error, req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle the request for the layer.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */
/**
 * 处理请求
 * @param {*} req 请求
 * @param {*} res 响应
 * @param {*} next 下一个中间件
 * @returns
 */
Layer.prototype.handle_request = function handle(req, res, next) {
  var fn = this.handle;
  /**
   * 如果 fn 的长度大于 3，则不是标准的请求处理程序
   */
  if (fn.length > 3) {
    // not a standard request handler
    return next();
  }

  try {
    /**
     * 调用路由处理函数
     */
    fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Check if this route matches `path`, if so
 * populate `.params`.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */
/**
 * 匹配路径
 * @param {*} path 路径
 * @returns
 */
Layer.prototype.match = function match(path) {
  var match
  /**
   * 如果 path 不为 null
   */
  if (path != null) {
    /**
     * 快速路径非结束匹配 / (任何路径匹配)
     */
    // fast path non-ending match for / (any path matches)
    if (this.regexp.fast_slash) {
      this.params = {}
      this.path = ''
      return true
    }
    /**
     * 快速路径 * (任何路径匹配)
     */
    // fast path for * (everything matched in a param)
    if (this.regexp.fast_star) {
      this.params = {'0': decode_param(path)}
      this.path = path
      return true
    }

    /**
     * 匹配路径
     */
    // match the path
    match = this.regexp.exec(path)
  }
  /**
   * 如果 match 为 null
   */
  if (!match) {
    /**
     * 设置 params 为 undefined
     */
    this.params = undefined;
    this.path = undefined;
    return false;
  }

  /**
   * 初始化 params和 path
   */
  this.params = {};
  this.path = match[0]

  var keys = this.keys;
  var params = this.params;
  /**
   * 遍历 match
   */
  for (var i = 1; i < match.length; i++) {
    /**
     * 设置 key
     */
    var key = keys[i - 1];
    /**
     * 设置 prop
     */
    var prop = key.name;
    /**
     * 设置 val
     */
    var val = decode_param(match[i])
    /**
     * 如果 val 不为 undefined 或 prop 不在 params 中
     */
    if (val !== undefined || !(hasOwnProperty.call(params, prop))) {
      /**
       * 设置 params[prop] 为 val
       */
      params[prop] = val;
    }
  }

  return true;
};

/**
 * Decode param value.
 *
 * @param {string} val
 * @return {string}
 * @private
 */
/**
 * 解码参数值
 * @param {*} val 值
 * @returns
 */
function decode_param(val) {
  if (typeof val !== 'string' || val.length === 0) {
    return val;
  }

  try {
    /**
     * 解码参数
     */
    return decodeURIComponent(val);
  } catch (err) {
    /**
     * 如果 err 是 URIError 实例
     */
    if (err instanceof URIError) {
      /**
       * 设置 err 的 message 和 status
       */
      err.message = 'Failed to decode param \'' + val + '\'';
      err.status = err.statusCode = 400;
    }
    /**
     * 抛出错误
     */
    throw err;
  }
}
