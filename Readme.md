### Simple library for management (install, uninstall and update) applications in Cloud Foundry (Pivotal) instances
___

### Installation

```bash
$ npm install node-cloudfoundry-apps-manager
```

### Example
```js
var cf = require('node-cloudfoundry-apps-manager');

var params = {
    endpoints: {
        login: 'login.cf-domain.com',
        api: 'api.cf-domain.com',
        ssl: true
    },
    username: 'username',
    password: 'password',
    appName: 'app-name',
    orgGuid: 'organisation guid',
    spaceGuid: 'space guid',
    appFile: 'url to zip file',
    // optional, or take the data from the manifest.yml
    instances: 1,
    memory: 128,
    disk_quota: 128,
    buildpack: 'https://github.com/dmikusa-pivotal/cf-php-build-pack.git'
};

/**
 * Example: cf push
 */

cf.install(params, function (error, data) {
    console.log(error, data); // return error or url
});

/**
 * Example: cf delete
 */

cf.uninstall(params, function (error, data) {
    console.log(error, data); // return error or true
});
```

### Contributors

 * Author: [lafin](https://github.com/lafin)

### License

  [MIT](LICENSE)
