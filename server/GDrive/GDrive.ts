const google = require('googleapis');
const debug = require('debug')('eMCloud::GDrive');
import * as FILE from 'fs';
import * as mime from 'mime';
import * as path from 'path';
import { EventEmitter } from 'events';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URL = process.env.GOOGLE_REDIRECT_URL;
const SCOPES = [
    'https://www.googleapis.com/auth/plus.me',
    'https://www.googleapis.com/auth/drive'
];
const SPEED_TICK_TIME = 500;

const OAuth2 = google.auth.OAuth2;


export class GDrive extends EventEmitter {
    private stack: Array<Array<any>> = [];
    private stackProcessing: boolean = false;
    static newOauthClient() {
        return new OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);
    }
    /**
     *Upload a file to GDrive
     * Emits:
     *      'progress'      :name,uploaded,size
     *      'fileUploaded':size,name,error
     */
    public uploadFile(stream, totalSize, mime, fileName, oauth2Client, parentId?, callback?) {
        //Init upload
        this.emit('progress', {
            type: 'file',
            name: fileName,
            uploaded: 0,
            size: totalSize
        });
        debug('Uploading file %s with parentId: %s', fileName, parentId);
        //start upload
        var drive = google.drive({ version: 'v3', auth: oauth2Client });
        var fileMetadata = {
            name: fileName,
            mimeType: mime
        }
        if (parentId) {
            fileMetadata['parents'] = [parentId];
        }
        var req = drive.files.create({
            resource: fileMetadata,
            media: {
                mimeType: mime,
                body: stream
            }
        }, (err, resp) => {
            debug('Uploaded %s to Drive Successfully', fileName);
            this.emit("fileUploaded", {
                size: totalSize,
                name: fileName,
                error: err
            });
            callback(err, resp);
        });
        var interval = setInterval(() => {
            this.emit("progress", {
                type: 'file',
                name: fileName,
                uploaded: req.req.connection.bytesWritten,
                size: totalSize
            });
            if (req.req.connection.bytesWritten >= totalSize) {
                clearInterval(interval);
            }
        }, SPEED_TICK_TIME);
        return req;
    }
    static getConsentPageURL(oauth2Client) {
        var url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES
        });
        return url;
    }
    /**
     *Create GDrive directory
     * Emits:
     *      'mkdir':name
     */
    private makeDir(name, oauth2Client, callback, parentId?) {
        this.emit('mkdir', {
            name: name
        });
        debug('Creating Directory %s with parentId: %s', name, parentId);
        var drive = google.drive({ version: 'v3', auth: oauth2Client });
        var fileMetadata = {
            name: name,
            mimeType: 'application/vnd.google-apps.folder'
        };
        if (parentId) {
            fileMetadata['parents'] = [parentId];
        }
        drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        }, function (err, file) {
            if (err) {
                // Handle error
                debug(err);
            } else {
                callback(file.id);
            }
        });

    }
    private uploadStack() {
        if (this.stack.length > 0) {
            this.stackProcessing = true;
            var params = this.stack[0];
            this.uploadFile(params[0], params[1], params[2], params[3], params[4], params[5], (err, resp) => {
                if (err) {
                    debug("Error processing stack: " + err);
                } else {
                    this.stack.splice(0, 1);
                    this.uploadStack();
                }
            });
        } else {
            this.stackProcessing = false;
        }
    }
    /**
     *Upload directory
     * Emits:
     *      'addSize':size
     */
    public uploadDir(folderPath, oauth2Client, parentId?) {
        FILE.readdir(folderPath, (err, list) => {
            if (!err) {
                list.forEach((item) => {
                    FILE.lstat(path.join(folderPath, item), (e, stat) => {
                        this.emit("addSize", {
                            size: stat.size
                        });
                        if (!err) {
                            if (stat.isDirectory()) {
                                this.makeDir(item, oauth2Client, (newParentId) => {
                                    this.uploadDir(path.join(folderPath, item), oauth2Client, newParentId);
                                }, parentId);
                            } else {
                                var fullPath = path.join(folderPath, item);
                                var stream = FILE.createReadStream(fullPath);
                                //this.uploadFile(stream, stat.size, mime.lookup(fullPath), item, oauth2Client, parentId);
                                this.stack.push([stream, stat.size, mime.lookup(fullPath), item, oauth2Client, parentId]);
                                if (!this.stackProcessing) {
                                    //stack not running
                                    this.uploadStack();
                                }
                            }
                        } else {
                            debug(err);
                        }
                    });
                });
            } else {
                debug(err);
            }
        });
    }
}