/* jshint -W079,-W059 */

var request = require('request'),
    async = require('async'),
    JSZip = require('jszip'),
    crypto = require('crypto'),
    FormData = require('form-data'),
    yaml = require('js-yaml');

var defaultHeaders = function (type, token) {
    return {
        'Accept': 'application/json',
        'Authorization': type + ' ' + token,
        'Content-Type': 'application/json'
    };
};

var type = null,
    token = null,
    appGuid = null,
    domainGuid = null,
    routeGuid = null,
    resourcesRemoteFile = null,
    dataRemoteFile = null,
    resourceMatched = null,
    manifest = null;

var getUrl = function (params, handler) {
    return 'http' + (params.endpoints.ssl ? 's' : '') + '://' + params.endpoints[handler];
};

var login = function (params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    request({
        method: 'POST',
        url: getUrl(params, 'login') + '/oauth/token',
        headers: {
            'Accept': 'application/json',
            'Authorization': 'Basic Y2Y6',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        form: {
            'grant_type': 'password',
            'username': params.username,
            'password': params.password
        }
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (!body) {
            return callback('Authorization error');
        }
        return callback(null, {
            'type': body.token_type,
            'token': body.access_token
        });
    });
};

function getSession(params, callback) {
    return async.memoize(login)(params, function (error, data) {
        type = data.type;
        token = data.token;
        return callback(null, data);
    });
}

var resources = function (params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    request({
        method: 'GET',
        url: params.appFile,
        encoding: null
    }, function (error, response, body) {
        if (error || response.statusCode !== 200) {
            return callback('Can not get file');
        }
        dataRemoteFile = body;
        var zip = new JSZip(body),
            resources = [];
        for (var i in zip.files) {
            if (zip.files.hasOwnProperty(i) && zip.files[i].dir === false) {
                var file = zip.files[i],
                    name = file.name,
                    buffer = zip.file(name).asText(),
                    sha1 = crypto.createHash('sha1');
                if (name.substr(name.lastIndexOf('/') + 1) === 'manifest.yml') {
                    manifest = yaml.safeLoad(buffer);
                }
                resources.push({
                    'fn': name,
                    'size': file._data.uncompressedSize,
                    'sha1': sha1.update(buffer).digest('hex')
                });
            }
        }
        callback(null, resources);
    });
};

function getResources(params, callback) {
    return async.memoize(resources)(params, function (error, data) {
        resourcesRemoteFile = data;
        return callback(null, true);
    });
}

function checkApp(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/spaces/' + params.spaceGuid + '/apps',
        headers: defaultHeaders(type, token),
        qs: {
            'q': 'name:' + params.appName,
            'inline-relations-depth': 1
        }
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.hasOwnProperty('total_results')) {
            if (body.total_results) {
                for (var i = 0; i < body.resources.length; i++) {
                    appGuid = body.resources[i].metadata.guid;
                    return callback(null, appGuid);
                }
            } else {
                return callback(null, false);
            }
        }
        return callback('Check app fail');
    });
}

function createApp(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    var bodyParams = {
        'name': params.appName,
        'space_guid': params.spaceGuid
    };
    if (manifest && manifest.applications) {
        var applications = manifest.applications;
        for (var a = 0; a < applications.length; a++) {
            var application = applications[a];
            if (application.memory) {
                bodyParams.memory = parseInt(application.memory, 10);
            }
            if (application.instances) {
                bodyParams.instances = parseInt(application.instances, 10);
            }
            if (application.disk_quota) {
                bodyParams.disk_quota = parseInt(application.disk_quota, 10);
            }
            if (application.buildpack) {
                bodyParams.buildpack = application.buildpack;
            }
        }
    }
    for (var i in params) {
        if (~['instances', 'memory', 'disk_quota', 'buildpack'].indexOf(i)) {
            bodyParams[i] = params[i];
        }
    }
    request({
        method: appGuid ? 'PUT' : 'POST',
        url: getUrl(params, 'api') + '/v2/apps' + (appGuid ? '/' + appGuid : ''),
        headers: defaultHeaders(type, token),
        qs: {
            'async': 'true'
        },
        body: JSON.stringify(bodyParams)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.metadata && body.metadata.guid && response.statusCode === 201) {
            appGuid = body.metadata.guid;
            return callback(null, appGuid);
        }
        return callback('Create app fail');
    });
}

function checkPrivateDomain(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/organizations/' + params.orgGuid + '/private_domains',
        headers: defaultHeaders(type, token)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && !body.total_results && response.statusCode === 200) {
            return callback(null, true);
        }
        return callback('Private domain fail');
    });
}

function checkSharedDomain(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/shared_domains',
        headers: defaultHeaders(type, token)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.total_results && response.statusCode === 200) {
            domainGuid = body.resources[0].metadata.guid;
            return callback(null, domainGuid);
        }
        return callback('Shared domain fail');
    });
}

function checkRoute(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/routes',
        headers: defaultHeaders(type, token),
        qs: {
            'q': 'host:' + params.appName + ';domain_guid:' + domainGuid,
            'inline-relations-depth': 1
        }
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && response.statusCode === 200) {
            if (body.total_results) {
                for (var i = 0; i < body.resources.length; i++) {
                    routeGuid = body.resources[i].metadata.guid;
                    return callback(null, routeGuid);
                }
            } else {
                return callback(null, false);
            }
        }
        return callback('Check route fail');
    });
}

function createRoute(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'POST',
        url: getUrl(params, 'api') + '/v2/routes',
        headers: defaultHeaders(type, token),
        qs: {
            'async': 'true',
            'inline-relations-depth': 1
        },
        body: JSON.stringify({
            'host': params.appName,
            'domain_guid': domainGuid,
            'space_guid': params.spaceGuid
        })
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.metadata && body.metadata.guid && response.statusCode === 201) {
            routeGuid = body.metadata.guid;
            return callback(null, routeGuid);
        }
        return callback('Create route fail');
    });
}

function acceptRoute(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'PUT',
        url: getUrl(params, 'api') + '/v2/apps/' + appGuid + '/routes/' + routeGuid,
        headers: defaultHeaders(type, token),
        body: JSON.stringify({
            'host': params.appName,
            'domain_guid': domainGuid,
            'space_guid': params.spaceGuid
        })
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.metadata && body.metadata.guid && response.statusCode === 201) {
            if (body.metadata.guid === appGuid) {
                return callback(null, true);
            }
        }
        return callback('Accept route fail');
    });
}

function checkResources(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'PUT',
        url: getUrl(params, 'api') + '/v2/resource_match',
        headers: defaultHeaders(type, token),
        body: JSON.stringify(resourcesRemoteFile)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (response.statusCode === 200) {
            resourceMatched = body;
            return callback(null, true);
        }
        return callback('Chech resource fail');
    });
}

function uploadApp(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    var form = new FormData(),
        CRLF = '\r\n',
        length = dataRemoteFile.length,
        filename = params.appFile.substr(params.appFile.lastIndexOf('/') + 1),
        options = {
            header: CRLF + [
                '--' + form.getBoundary(),
                'Content-Disposition: form-data; name="application"; filename="' + filename + '"',
                'Content-Type: application/zip',
                'Content-Length: ' + length,
                'Content-Transfer-Encoding: binary'
            ].join(CRLF) + CRLF + CRLF,
            knownLength: length
        };

    form.append('async', 'true');
    form.append('resources', JSON.stringify(resourceMatched));
    form.append('application', dataRemoteFile, options);

    form.getLength(function () {
        var req = request({
            method: 'PUT',
            url: getUrl(params, 'api') + '/v2/apps/' + appGuid + '/bits',
            headers: {
                'Accept': 'application/json',
                'Authorization': type + ' ' + token
            },
            qs: {
                'async': 'true'
            },
            formData: {
                'async': 'true',
                'resources': JSON.stringify(resourceMatched),
                'application': dataRemoteFile
            }
        }, function (error, response, body) {
            if (error) {
                return callback(error);
            }
            if (response.statusCode === 401) {
                return callback('Authorization error');
            }
            try {
                body = JSON.parse(body);
            } catch (e) {
                body = null;
            }
            if (response.statusCode >= 400) {
                return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
            }
            if (body && body.metadata && body.metadata.guid && response.statusCode === 201) {
                return callback(null, body.metadata.guid);
            }
            return callback('Upload fail');
        });
        req._form = form;
    });
}

function checkJob(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/jobs/' + params.uploadJobGuid,
        headers: defaultHeaders(type, token)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.metadata && body.metadata.hasOwnProperty('guid') && response.statusCode === 200) {
            return callback(null, body.metadata.guid === '0');
        }
        return callback('Check job fail');
    });
}

function changeStatusApp(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'PUT',
        url: getUrl(params, 'api') + '/v2/apps/' + appGuid,
        headers: defaultHeaders(type, token),
        qs: {
            'async': 'true',
            'inline-relations-depth': 1
        },
        body: JSON.stringify({
            'state': params.status ? params.status : 'STARTED'
        })
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (body && body.metadata && body.metadata.hasOwnProperty('guid') && response.statusCode === 201) {
            if (body.metadata.guid === appGuid) {
                return callback(null, true);
            }
        }
        return callback('Change status app fail');
    });
}

function checkInstance(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/apps/' + appGuid + '/instances',
        headers: defaultHeaders(type, token)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (response.statusCode === 200) {
            return callback(null, true);
        }
        return callback('Chech instance fail');
    });
}

function deleteApp(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'DELETE',
        url: getUrl(params, 'api') + '/v2/apps/' + appGuid,
        headers: defaultHeaders(type, token),
        qs: {
            'async': 'true',
            'recursive': 'true'
        }
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        return callback(null, response.statusCode === 204);
    });
}

function checkStat(params, callback) {
    if (!params) {
        return callback('Not enough parameters');
    }
    var functionName = arguments.callee.name;
    request({
        method: 'GET',
        url: getUrl(params, 'api') + '/v2/apps/' + appGuid + '/stats',
        headers: defaultHeaders(type, token)
    }, function (error, response, body) {
        if (error) {
            return callback(error);
        }
        if (response.statusCode === 401) {
            return callback('Authorization error');
        }
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
        if (response.statusCode >= 400) {
            return callback(functionName + ': ' + (body && body.hasOwnProperty('description') ? body.description : 'Unknown error'));
        }
        if (response.statusCode === 200) {
            var successRun = 0,
                url = null;
            if (body) {
                for (var i in body) {
                    if (body.hasOwnProperty(i) && body[i].state === 'RUNNING') {
                        url = body[i].stats.uris.length ? body[i].stats.uris[0] : null;
                        ++successRun;
                    }
                }
            }
            return callback(null, Object.keys(body).length === successRun ? url : false);
        }
        return callback('Chech instance fail');
    });
}

function reset(callback) {
    appGuid = null;
    callback();
}

exports = module.exports = {
    install: function (params, callback) {
        async.series([
            function (callback) {
                reset(callback);
            },
            function (callback) {
                getResources(params, callback);
            },
            function (callback) {
                getSession(params, callback);
            },
            function (callback) {
                checkApp(params, function (error, result) {
                    if (result) {
                        params.status = 'STOPPED';
                        return changeStatusApp(params, callback);
                    }
                    return callback(null, true);
                });
            },
            function (callback) {
                createApp(params, callback);
            },
            function (callback) {
                checkPrivateDomain(params, callback);
            },
            function (callback) {
                checkSharedDomain(params, callback);
            },
            function (callback) {
                checkRoute(params, function (error, result) {
                    if (result) {
                        return callback(error, result);
                    }
                    return createRoute(params, callback);
                });
            },
            function (callback) {
                acceptRoute(params, callback);
            },
            function (callback) {
                checkResources(params, callback);
            },
            function (callback) {
                uploadApp(params, function (error, data) {
                    if (error) {
                        return callback(arguments);
                    }
                    var maxLoopCount = 10;
                    params.uploadJobGuid = data;
                    var sameCallback = function (error, data) {
                        if (data) {
                            return callback(null, true);
                        } else {
                            --maxLoopCount;
                            if (maxLoopCount) {
                                setTimeout(function () {
                                    checkJob(params, sameCallback);
                                }, 2000);
                            } else {
                                return callback('Infinity loop check job');
                            }
                        }
                    };
                    checkJob(params, sameCallback);
                });
            },
            function (callback) {
                params.status = 'STARTED';
                changeStatusApp(params, callback);
            },
            function (callback) {
                var maxLoopCount = 10;
                var sameCallback = function () {
                    return checkStat(params, function (error, data) {
                        if (data) {
                            return callback(null, data);
                        } else {
                            --maxLoopCount;
                            if (maxLoopCount) {
                                setTimeout(function () {
                                    checkInstance(params, sameCallback);
                                }, 2000);
                            } else {
                                return callback('Infinity loop check status');
                            }
                        }
                    });
                };
                return checkInstance(params, sameCallback);
            }
        ], function (error, results) {
            callback(error ? new Error(error) : null, results[results.length - 1]);
        });
    },
    uninstall: function (params, callback) {
        async.series([
            function (callback) {
                reset(callback);
            },
            function (callback) {
                getSession(params, callback);
            },
            function (callback) {
                checkApp(params, function (error, result) {
                    if (!error && result) {
                        return deleteApp(params, callback);
                    }
                    return callback(arguments);
                });
            }
        ], function (error, results) {
            callback(error ? new Error(error) : null, results[results.length - 1]);
        });
    }
};