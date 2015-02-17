/**
 * @name Android
 * @version 0.1.0
 * @fileoverview contains Android's specific build processes
 */

var libs = require('corci-libs');
var Common = libs.Common;
var Logger = libs.Logger;

var P = Common.Promise;
var multiGlob = Common.multiGlob;
var whereis = P.promisify(require('whereis'));

var fs = Common.fsExtra;
var path = require('path');

/**
 * Constructor of the android build sequence
 * @class
 */
function Android(buildfolder) {
    this._buildfolder = buildfolder;
    Logger.addLevels({
        android: 3
    }, {
        android: 'cyan'
    });
}

Android.PID = 'android';

Android.prototype.getFolder = function (tag) {
    var folders = {
        android: 'platforms/android',
        cordova: 'platforms/android/cordova',
        www: 'platforms/android/assets/www',
        signLog: 'build.android.sign.jarsign.log',
        alignLog: 'build.android.zipalign.log'
    };

    return path.resolve(this._buildfolder, folders[tag] || '');
};

Android.prototype.getAPKs = function () {
    var glob = 'platforms/android/**/*.apk';
    var _this = this;
    return new P(function (resolve, reject) {
        multiGlob(glob, {
            cwd: _this.getFolder()
        }, function (err, files) {
            if (err) {
                reject(err);
            } else {
                resolve(files);
            }
        });
    });
};

/**
 * Initiate building sequence
 * looks for existing APKs
 */
Android.prototype.onInit = function () {
    Logger.android('onInit Hook');

    // delete existing APKs
    return this.getAPKs()
        .map(function (file) {
            return fs.removeAsync(file);
        })
        .catch(function (err) {
            Logger.android('Error deleting existing APKs', err);
        });
};


/**
 * Hook into filesDone to make some file manipulations
 */
Android.prototype.onFilesDone = function () {
    return this.ensureLocalProperties()
        .catch(function (err) {
            Logger.android('Failed ensuring local.properties', err)
        })
        .then(this.ensureAssetsFolder.bind(this))
        .catch(function (err) {
            Logger.android('Failed ensuring the assets folder', err);
        })
        .then(this.chmodAndroidBuild.bind(this))
        .catch(function (err) {
            Logger.android('Could not chmod android build binary', err);
        });


    // @TODO: rework?
    //@TODO: remove bind this
    /*this.agent.log(this.build, Msg.info, "Searching for existing apks for a faster build");
     var cordovaLibPath = path.resolve(this.androidFolder, 'CordovaLib');
     fs.exists(cordovaLibPath, function(cordovaLibPathExists) {
     if (!cordovaLibPathExists && this.build.conf.androidreleaseapk) {
     var source = this.build.conf[this.build.conf.buildmode === 'release' ? 'androidreleaseapk' : 'androiddebugapk'];
     var dest = path.resolve(this.androidFolder, path.basename(source));
     fs.copy(source, dest, function(err) {
     if (this.build.conf.status === 'cancelled') {
     return;
     }
     if (err) {
     return this.agent.buildFailed(this.build, 'Error copying apk {2} to {3}\n{4}', source, dest, err);
     }
     this.apkGlobPath = [dest];
     this.updateAssetsWWW = true;
     this.agent.log(this.build, Msg.info, "Apk found {2}. Updating only assets/www for a faster build", this.apkGlobPath[0]);
     this.ensureAssetsFolder.call(this, "cordova prepare {0} {1}");
     });
     } else {
     this.ensureAssetsFolder.call(this);
     }
     }.bind(this));*/
};

Android.prototype.ensureLocalProperties = function () {
    var localProps = path.resolve(this.getFolder('android'), 'local.properties');
    var androidHomeEnv = process.env.ANDROID_HOME && process.env.ANDROID_HOME.length > 0;

    if (androidHomeEnv) {
        // Delete localProps as Ant will find android through ANDROID_HOME
        return fs.removeAsync(localProps);
    } else {
        // Search for the android executable
        var _this = this;
        return whereis('android').then(function (androidFile) {
            return _this.writeLocalProperties(localProps, androidFile);
        });
    }
};

/**
 * Replace local properties with system sdk.dir
 *
 * @param {String} localProps  - path to the local.properties file
 * @param {String} androidFile - the path to the android executable
 */
Android.prototype.writeLocalProperties = function (localProps, androidFile) {
    var sdkDir = path.resolve(androidFile, '..', '..').replace(/\\/g, '\\\\');
    return fs.writeFileAsync(localProps, 'sdk.dir=' + sdkDir);
};

/**
 * Tries to make android's build file executable
 */
Android.prototype.chmodAndroidBuild = function () {
    var cordovaBuildFile = path.resolve(this.getFolder('cordova'), 'build');
    Logger.android('Chmodding ' + cordovaBuildFile + ' as hell....');
    return fs.chmodAsync(cordovaBuildFile, '755');
};

/**
 * Ensure assets folder exists (if necessary creates it)
 */
Android.prototype.ensureAssetsFolder = function () {
    return fs.ensureDirAsync(this.getFolder('www'));
};

/**
 * Hook into preCordovaBuild to
 */
Android.prototype.preBuild = function () {
    Logger.android('Hook: preBuild');
};

/**
 * Hook into the {@link GenericBuild}s buildDone callback
 */
Android.prototype.onBuildDone = function () {
    //@todo: signing process
    //this.sign();

    return this.getAPKs();
    //@todo: log?, signLog?,... 'build.android.log', this.signLogPath, this.alignLogPath
};

/**
 * Initiates the signing process
 */

//@todo: rewrite
Android.prototype.sign = function () {
    if (this.build.conf.androidsign) {
        multiGlob(this.apkGlobPath, {
            cwd: this.buildfolder
        }, function (err, apks) {
            //we should sign unaligned apks
            apks = apks.filter(function (apk, i) {
                return !i;
            });
            this.apkGlobPath = apks;
            this.agent.archiver.modifyArchive.call(this.agent.archiver, this.build, 'd', apks[0], 'META-INF', {
                cwd: this.buildfolder,
                maxBuffer: maxBuffer
            }, this.jarSigner);
        }.bind(this));
    } else {
        this.done();
    }
};

/**
 * Sign the generated APKs
 */

//@todo: rewrite
Android.prototype.jarSigner = function () {
    var apks = this.apksGlobPath;
    var androidsign = this.build.conf.androidsign;
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    this.agent.log(this.build, Msg.debug, 'APK Files:\n{2}', apks.join('\n'));
    var _self = this;
    apks = apks.map(function (apk) {
        return path.resolve(_self.buildfolder, apk);
    });
    androidsign = androidsign.format.apply(androidsign, apks) + ' 2>&1 | "{0}" "{1}" | "{2}" -i -E -v "(tsacert|signing|warning|adding)"'.format(tee, this.signLogPath, egrep);
    this.agent.log(this.build, Msg.status, androidsign);

    this.agent.exec(this.build, androidsign, {
        maxBuffer: maxBuffer
    }, function (err, stdout, stderr) {
        if (err || stderr) {
            return;
        }
        this.zipAlign(apks[0]);
    }.bind(this), 'android sign process exited with code {2}');
};

/**
 * zipalign the APKs to reduce RAM consumption when running the application
 *
 * @param {String} apk - apk file
 * @see [zipalign | Android Developers]{@link https://developer.android.com/tools/help/zipalign.html}
 */

//@todo: rewrite
Android.prototype.zipAlign = function (apk) {
    var output = apk.replace('-unsigned', '').replace('-unaligned', '');
    var key = this.build.conf.androidsign.match(/(.*)(\\|\/| )(.*)(\.keystore)/i);
    key = key && key[3];
    key = key && ("-" + key);
    output = path.resolve(path.dirname(apk), path.basename(output, '.apk') + key + '-signed-aligend.apk');
    if (apk === output) {
        output = output.replace('.apk', '-updated.apk');
    }
    var zipalign = 'zipalign -f -v 4  "{0}" "{1}"'.format(apk, output);
    zipalign = zipalign + ' 2>&1 | "{0}" "{1}" | "{2}" -i -A 5 "(success)""'.format(tee, this.alignLogPath, egrep);

    var _self = this;
    this.agent.exec(this.build, zipalign, {
        cwd: this.buildfolder,
        maxBuffer: maxBuffer
    }, function (err, stdout, stderr) {
        if (err && (!err.code || err.code !== 1) || stdout || _self.build.conf.status === 'cancelled') {
            return;
        }
        _self.apkGlobPath = [output];
        _self.done();
    }, 'android zipalign process exited with code {2}');
};

module.exports = Android;