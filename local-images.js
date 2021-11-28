'use strict';
const https = require('https');
const http = require('http');
const path = require('path');
const url = require('url');
const fs = require('fs');
const util = require('gulp-util');
const through = require('through2');
const cheerio = require('cheerio');
const crypto = require('crypto');
const PLUGIN_NAME = 'gulp-localize-images';
const MIME_TYPE_REGEX = /.+\/([^\s]*)/;
const LOCALIZE_ATTR = 'localize';
const NOT_LOCALIZE_ATTR = `!${LOCALIZE_ATTR}`;

function plugin(options = {}, folder = '', image_path_after = '') {
    console.log(`going to localize image in ${folder} in ${image_path_after}`);
    var selector = options.selector || 'img[src]';
    var attribute = options.attribute || 'src';

    return through.obj(function(file, encoding, callback) {
        if (file.isStream()) {
            this.emit('error', new util.PluginError(PLUGIN_NAME, 'Streams are not supported!'));
            return callback();
        }

        if (file.isBuffer()) {
            var contents = file.contents.toString(encoding);
            // Load it into cheerio's virtual DOM for easy manipulation
            var $ = cheerio.load(contents, { decodeEntities: false });
            var localize_flag = $(`img[${LOCALIZE_ATTR}]`);

            console.log(selector)

            if(selector === 'div[style*="background"]'){
                var img_tags = $(selector);
                console.log(img_tags);
            } else {
                // If images with an localize attr are found that is the selection we want
                var img_tags = localize_flag.length ? localize_flag : $(selector);
            }
            var count = 0;

            img_tags.each(function() {
                var $img = $(this);

                if(selector === 'div[style*="background"]'){
                    var src = $img.css('background').slice(4, -1).replace(/['"]+/g, '');
                    console.log(src);
                    // Save the file format from the extension
                    var ext_format = path.extname(src).substr(1);
                } else {
                    var src = $img.attr(attribute);
                    // Save the file format from the extension
                    var ext_format = path.extname(src).substr(1);

                    // If localize_flag tags were found we want to remove the localize tag
                    if (localize_flag.length) {
                        $img.removeAttr(LOCALIZE_ATTR);
                    }

                    // Find !localize attribute
                    var not_localize_flag = $img.attr(NOT_LOCALIZE_ATTR);

                    if (typeof not_localize_flag !== typeof undefined && not_localize_flag !== false) {
                        // Remove the tag and don't process this file
                        return $img.removeAttr(NOT_LOCALIZE_ATTR);
                    }
                }

                // Count async ops
                count++;
                
                console.log(`going to get image for ${file.base} in ${src} in ${folder} in ${image_path_after}`);
                getSrcBase64(options.basedir || file.base, src, folder, image_path_after, function(err, result, res_format, filepath, image_path_after) {
                    if (err) console.error(err);
                    else
                        // Need a format in and a result for this to work
                        if (result && (ext_format || res_format)) {
                            // $img.attr('src', `data:image/${ext_format};base64,${result}`);
                            console.log(`starting path is: ${filepath}`);

                            var exclude_path = process.cwd()+ '/' +image_path_after;
                            console.log(`exclude path is: ${exclude_path}`);

                            var relative_path = getFilePath(filepath, exclude_path);
                            console.log(`relative path is: ${relative_path}`);


                            console.log(`Going to set file to .${relative_path}`);
                            // $img.attr('src', `.${relative_path}`);

                            if(selector === 'div[style*="background"]'){
                                $img.css('background', `url(.${relative_path})`);
                            } else {
                                $img.attr(attribute, `.${relative_path}`);
                            }
                        } else {
                            console.error(`Failed to identify format of ${src}!`);
                        }
                    if (!--count) {
                        file.contents = Buffer.from($.html());
                        callback(null, file);
                    }
                });
            });

            // If no files are processing we don't need to wait as none were ever started
            if (!count) {
                file.contents = Buffer.from($.html());
                callback(null, file);
            }
        }
    });
}

// fs create directory based on a full file path even if it does not exist
function createDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createDirFromPath(path) {
  const dir = path.split('/').slice(0, -1).join('/');
  createDir(dir);
}

// get file path after excluding an initial path
function getFilePath(filePath, initialPath) {
  if (filePath.indexOf(initialPath) === 0) {
    return filePath.slice(initialPath.length);
  }

  return filePath;
}

function getHTTPBase64(url, folder, image_path_after, callback) {
    console.log(url);

    const filename = url.split('?')[0].split('/').pop();
    const dir = process.cwd();
    const url_md5 = crypto.createHash('md5').update(url).digest('hex');
    const filepath = `${dir}/${folder}/${filename}`;
    const destDir = createDirFromPath(filepath);
    console.log(`filepath is ${filepath}, directory is ${dir}, filename is ${filename} and folder is ${folder}`);

    // Get applicable library
    var lib = url.startsWith('https') ? https : http;
    // Initiate a git request to our URL
    var req = lib.get(url, (res) => {
        // Check for redirect
        if (res.statusCode >= 301 && res.statusCode < 400 && res.headers.location) {
            // Redirect
            return getHTTPBase64(res.headers.location, folder, callback);
        }
        // Check for HTTP errors
        if (res.statusCode < 200 || res.statusCode >= 400) {
            return callback(new Error('Failed to load page, status code: ' + res.statusCode));
        }
        // Get file format
        var format;
        if (res.headers['content-type']) {
            var matches = res.headers['content-type'].match(MIME_TYPE_REGEX);
            if (matches) format = matches[1];
        }

        // Create an empty buffer to store the body in
        var body = Buffer.from([]);

        // Append each chunk to the body
        res.on('data', (chunk) => body = Buffer.concat([body, chunk]));

        // Done callback
        res.on('end', () => {
            var fileExists = fs.existsSync(filepath);

            var filename = path.basename(filepath);
            var filefolder = filepath.substring(0, filepath.lastIndexOf("/") + 1);

            console.log(`filename is: ${filename}`);
            console.log(`filefolder is: ${filefolder}`);

            var i = 0;
            while (fileExists) {
                i++;
                filename = i + "-" + filename;
                fileExists = fs.existsSync(`${filefolder}${filename}`);
            }

            var new_file = `${filefolder}${filename}`;
            new_file=decodeURIComponent(new_file);
            console.log(`filename is: ${new_file}`);

            fs.writeFileSync(new_file, body);
            callback(null, body.toString('base64'), format, new_file, image_path_after)
        });

        // res.on('end', () => callback(null, body.toString('base64'), format));
    });

    // Listen for network errors
    req.on('error', (err) => callback(err));
}

function getSrcBase64(base, src, folder, image_path_after, callback) {
    console.log(`getting image for ${base} in ${src} in ${folder} in ${image_path_after}`);
    if (!url.parse(src).hostname) {
        // Get local file
        var file_path = path.join(base, src);
        fs.readFile(file_path, 'base64', callback);
    } else {
        // Get remote file
        getHTTPBase64(src, folder, image_path_after, callback);
    }
}

module.exports.plugin = plugin;
module.exports.getHTTPBase64 = getHTTPBase64;
module.exports.getSrcBase64 = getSrcBase64;