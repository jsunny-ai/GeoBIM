// Patches fs.realpathSync so Vite never sees the # character in the project root.
// Needed because C:\antigravity\#1_4_GeoBIM\... has # which Vite's cleanUrl()
// treats as a URL fragment, stripping the file extension and breaking JSX transform.
// G: is subst'd to C:\antigravity\#1_4_GeoBIM before node is launched.
const fs = require('fs')

const RE = /C:[\\\/]antigravity[\\\/]#1_4_GeoBIM/gi

function fix(p) {
  return typeof p === 'string' ? p.replace(RE, 'G:') : p
}

const origSync = fs.realpathSync
fs.realpathSync = function (path, options) {
  return fix(origSync.call(this, path, options))
}
fs.realpathSync.native = function (path, options) {
  return fix(origSync.native.call(this, path, options))
}

const origAsync = fs.realpath
fs.realpath = function (path, options, cb) {
  if (typeof options === 'function') { cb = options; options = {} }
  origAsync.call(this, path, options, (err, res) => cb(err, err ? res : fix(res)))
}
fs.realpath.native = function (path, options, cb) {
  if (typeof options === 'function') { cb = options; options = {} }
  origAsync.native.call(this, path, options, (err, res) => cb(err, err ? res : fix(res)))
}
