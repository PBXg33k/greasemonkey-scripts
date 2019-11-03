// ==UserScript==
// @name         EH-Enhanced
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @include      /^https?:\/\/e\-hentai\.org\/(uploader\/.*|tag\/[\w]+\:[\w\+]+|\?[\w\=\d\&]+|[\w]+)?$
// @grant        none
// ==/UserScript==

function EHentaiDownloadHelperConfig() {
    this.loadConfig();
}

EHentaiDownloadHelperConfig.prototype = {
    localStorageKey: 'EhentaiDownloadHelper',
    archiverUri: 'https://e-hentai.org/archiver.php',
    apiConfig: {
        serverUri: 'https://api.e-hentai.org/api.php',
        limits: {
            galleries: 25,
            requests: 5,
            waitTime: 5
        }
    },
    localConfig: {
        requestQueue: [],
        lastCallTimestamp: null,
        history: []
    }
};

EHentaiDownloadHelperConfig.prototype.updateLastApiCallTimestamp = function () {
    this.localConfig.lastCallTimestamp = new Date();
};

EHentaiDownloadHelperConfig.prototype.addRequestToQueue = function(request) {
    this.localConfig.requestQueue.unshift(request);
};

EHentaiDownloadHelperConfig.prototype.getRequestFromQueue = function() {
    return this.localConfig.requestQueue.pop()
};

EHentaiDownloadHelperConfig.prototype.storeConfig = function() {
    window.localStorage.setItem(this.localStorageKey, JSON.stringify(this.localConfig));
};

EHentaiDownloadHelperConfig.prototype.addGalleryToHistory = function(gallery) {
    if(!this.isGalleryDownloaded(gallery)) {
        this.localConfig.history.push(gallery.id);
        this.storeConfig();
    }
};

EHentaiDownloadHelperConfig.prototype.isGalleryDownloaded = function(gallery) {
    return this.localConfig.history.indexOf(parseInt(gallery.id).toString()) !== -1;
};

EHentaiDownloadHelperConfig.prototype.loadConfig = function () {
    if(window.localStorage.getItem(this.localStorageKey) !== null) {
        this.localConfig = JSON.parse(window.localStorage.getItem(this.localStorageKey));
    }
};


function EHentaiApiHelper() { }

EHentaiApiHelper.prototype = {};
EHentaiApiHelper.prototype.config = new EHentaiDownloadHelperConfig();

EHentaiApiHelper.prototype.galleryQueue = [];

EHentaiApiHelper.prototype.addGalleryToMetaQueue = function(gallery) {
    this.galleryQueue.push(gallery);
};

EHentaiApiHelper.prototype.sendMetaRequest = function(that) {
    // Split up calls by gallery limit
    let i, j;

    const apiUri = 'https://api.e-hentai.org/api.php';
    const xhr = new XMLHttpRequest();

    if(this.galleryQueue.length > 0) {
        for (i = 0, j = this.galleryQueue.length; i < j; i += this.config.apiConfig.limits.galleries) {
            // @todo add a wait

            let apiArray = [];

            this.galleryQueue.slice(i, i + this.config.apiConfig.limits.galleries).forEach(function (item) {
                this.push([item.id, item.token]);
            }, apiArray);

            xhr.open('POST', apiUri, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function () {
                if (this.readyState !== 4) return;

                if (this.status === 200) {
                    const data = JSON.parse(this.responseText);

                    data.gmetadata.forEach(function (item) {
                        that.galleries[item.gid].metadata = item;
                    }, window.GalleryDownloadHelper);

                    console.debug('Loaded metadata for galleries', data.gmetadata.forEach(function (item) {
                    }))
                }
            };
            xhr.send(JSON.stringify({
                method: 'gdata',
                namespace: 1,
                gidlist: apiArray
            }));

        }
    }
};


function Gallery() { }

Gallery.prototype = { };
Gallery.prototype.API = new EHentaiApiHelper();
Gallery.prototype.fromThumbnailView = function(element) {
    this.name = element.children[0].children[0].textContent.trim();
    this.uri = element.children[0].attributes.href.value;

    const extractedData = this.extractDataFromGalleryURI(this.uri);
    this.id = extractedData.id;

    this.token = extractedData.token;
    return this;
};

Gallery.prototype.fromListView = function(element) {
    let infoElement = element.getElementsByClassName('gl3m glname')[0].children[0];
    this.name = infoElement.textContent;

    const extractedData = this.extractDataFromGalleryURI(infoElement.attributes['href'].value);
    this.id = extractedData.id;
    this.token = extractedData.token;
    return this;
};

Gallery.prototype.downloadArchive = function() {
    if(typeof this.metadata !== "undefined") {
        popUp(`${this.API.config.archiverUri}?gid=${this.id}&token=${this.token}&or=${this.metadata.archiver_key}`, 480,320);
    }
};

Gallery.prototype.loadMetadataFromApi = function() {
    this.API.addGalleryToMetaQueue(this);
    this.API.sendMetaRequest();
};

Gallery.prototype.extractDataFromGalleryURI = function(uri) {
    function returnObj(uri) {
        const data = uri.match(/https?:\/\/e-hentai\.org\/g\/([0-9]+)\/([0-9a-fA-F]+)\/?/);

        this.id = data[1];
        this.token = data[2];

        return this;
    };

    return new returnObj(uri);
};

function GalleryDownloadHelper() {
    console.debug('Initializing GalleryDownloadHelper');
    this.galleries = [];
    this.loadGalleries();
}

GalleryDownloadHelper.prototype = {
};

GalleryDownloadHelper.prototype.API = new EHentaiApiHelper();

GalleryDownloadHelper.prototype.loadGalleries = function() {
    // Detect if we're in list or thumbnailview
    switch (document.getElementById('dms').children[0].children[0].children[document.getElementById('dms').children[0].children[0].selectedIndex].value) {
        case  't': // Thumbnail
            this.loadGalleriesFromThumbnailView();
            break;
        case 'm': // Minimal
        case 'p': // Minimal+
            this.loadGalleriesFromListView();
            break;
        case 'l': // Compact
        case 'e': // Extended
        default:
            console.log('This view is not yet supported');
    }
};

GalleryDownloadHelper.prototype.loadGalleriesFromThumbnailView = function() {
    const elements = document.getElementsByClassName('gl1t');
    for (let i=0; i<elements.length; i++) {
        let gallery = new Gallery().fromThumbnailView(elements[i]);
        this.galleries[gallery.id] = gallery;
        this.appendDownloadButtonToThumbnailView(elements[i], gallery);
    }

    // Fire API call
    this.API.sendMetaRequest(this);
};

GalleryDownloadHelper.prototype.addColumnToTableView = function() {
    let table = document.getElementsByClassName('itg gltm')[0];

    table.tBodies[0].rows[0].children[3].colSpan = 2;
};

GalleryDownloadHelper.prototype.loadGalleriesFromListView = function () {
    this.addColumnToTableView();

    const elements = document.getElementsByClassName('itg gltm')[0].children[0].children
    console.log(elements.length);

    // i starts from one to skip the header row
    for (let i=1; i<elements.length; i++) {
        let gallery = new Gallery().fromListView(elements[i]);
        this.galleries[gallery.id] = gallery;
        this.appendDownloadButtonToListView(elements[i], gallery);
    }
    this.API.sendMetaRequest(this);
};

GalleryDownloadHelper.prototype.appendDownloadButtonToThumbnailView = function (element, gallery) {
    let target = element.getElementsByClassName('gl6t')[0];
    if(typeof target === "undefined") {
        let divElement = document.createElement('div');
        divElement.className = 'gl6t';
        element.insertBefore(divElement, element.getElementsByClassName('gl5t')[0]);

        return this.appendDownloadButtonToThumbnailView(element, gallery);
    }
    target.prepend(this.downloadButtonTemplate(gallery));
    this.API.addGalleryToMetaQueue(gallery);
};

GalleryDownloadHelper.prototype.appendDownloadButtonToListView = function (element, gallery) {
    let target = element.getElementsByClassName('gl4m')[0];

    let column = document.createElement('td');
    column.append(this.downloadButtonTemplate(gallery));

    target.parentElement.insertBefore(column, target);
    this.API.addGalleryToMetaQueue(gallery);
};

GalleryDownloadHelper.prototype.downloadButtonTemplate = function (gallery) {
    const colors = {
        notDownloaded: {
            color: '#f1f1f1',
            border: '#dd13df',
            gradient: '#dd13df,#d954da'
        },
        downloaded: {
            color: '#000000',
            border: '#1edf13',
            gradient: '#1edf13,#5cda54'
        }
    };

    let state = this.API.config.isGalleryDownloaded(gallery) ? 'downloaded' : 'notDownloaded';

    const button = document.createElement('div');
    button.className = 'gt hack';
    button.style = `border-color: ${colors[state].border};background: radial-gradient(${colors[state].gradient}) !important; text-align: center`;
    button.innerHTML = `<a href="#" style="color:${colors[state].color}" data-id="${gallery.id}" onclick="GalleryDownloadHelper.downloadArchive(this); return false" >Download Archive</a>`;
    button.gallery = gallery;

    return button;
};

GalleryDownloadHelper.prototype.downloadArchive = function(element) {
    let Gallery = this.galleries[element.attributes['data-id'].value];
    this.API.config.addGalleryToHistory(Gallery);

    Gallery.downloadArchive();
};

let gdh = new GalleryDownloadHelper();
Window.prototype.GalleryDownloadHelper = gdh;
