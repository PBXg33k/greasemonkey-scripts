// ==UserScript==
// @name         EHentai-Enhanced
// @version      1.2.4
// @description  Adds extra stuff to e-hentai.org pages. Uses indexedDB to cache calls/respones made to the EHentai API.
// @author       PBXg33k
// @match        https://e-hentai.org/uploader/*
// @match        https://e-hentai.org/tag/*
// @match        https://e-hentai.org/archiver.php*
// @match        https://e-hentai.org/exchange.php*
// @match        https://e-hentai.org/*
// @include      /^https?:\/\/e\-hentai\.org\/((\?[\w\=\d\&\:\%\+]+|[\w\-]+)(\/[\d+]?)?(\?.*)?)?$
// @require      https://unpkg.com/dexie@latest/dist/dexie.js
// @updateURL    https://openuserjs.org/meta/PBXg33k/EHentai-Enhanced.meta.js
// @supportURL   https://github.com/PBXg33k/greasemonkey-scripts/issues
// @website      https://github.com/PBXg33k/greasemonkey-scripts
// @copyright    2019-2022, PBXg33k (https://openuserjs.org/users/PBXg33k)
// @license      MIT
// ==/UserScript==
// @todo         - Load userId from session to enable/disable features

function EHentaiDownloadHelperCache(parent) {
    this.parent = parent;
    this.db = [];
}

EHentaiDownloadHelperCache.prototype = {
    dbNames: {
        galleryCache: 'galleryCache'
    }
};

EHentaiDownloadHelperCache.prototype.openGalleryCache = function () {
    if (typeof this.db[this.dbNames.galleryCache] === "undefined") {
        this.db[this.dbNames.galleryCache] = new Dexie(this.dbNames.galleryCache);
        this.db[this.dbNames.galleryCache].version(1).stores({
            galleries: 'id,token,name,image,metadata',
            downloads: 'id,downloaded_on'
        });
        this.db[this.dbNames.galleryCache].version(2).stores({
            galleries: 'id,token,name,image,metadata,timestamp',
            downloads: 'id,downloaded_on'
        }).upgrade(tx => {
            return tx.galleries.toCollection().modify(gallery => {
                gallery.timestamp = new Date(Date.now());
            });
        });
    }

    return this.db[this.dbNames.galleryCache];
};

EHentaiDownloadHelperCache.prototype.galleryCacheGet = function (galleryid, onsuccess, onerror) {
    const that = this;
    const db = this.openGalleryCache();
    db.galleries.where('id').equals(galleryid).first().then(function (dbentry) {
        if (typeof (dbentry) !== "undefined") {
            // Check if cache is expired or not
            if (new Date(dbentry.timestamp) > new Date(new Date().getTime() - (24 * 60 * 60 * 1000))) {
                onsuccess(new Gallery(that.parent).fromCache(dbentry));
                return;
            }
        }
        onsuccess(undefined);
    }).catch(onerror);
};

EHentaiDownloadHelperCache.prototype.galleryCacheSet = function (gallery, onsuccess, onerror) {
    const db = this.openGalleryCache();
    db.galleries.put(JSON.parse(JSON.stringify(gallery))).then(onsuccess).catch(onerror);
};

function EHentaiDownloadHelperConfig(parent) {
    this.parent = parent;
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
    },
    cloudFlare: {
        enabled: false,
    }
};

EHentaiDownloadHelperConfig.prototype.updateLastApiCallTimestamp = function () {
    this.localConfig.lastCallTimestamp = new Date();
};

EHentaiDownloadHelperConfig.prototype.addRequestToQueue = function (request) {
    this.localConfig.requestQueue.unshift(request);
};

EHentaiDownloadHelperConfig.prototype.getRequestFromQueue = function () {
    return this.localConfig.requestQueue.pop()
};

EHentaiDownloadHelperConfig.prototype.storeConfig = function () {
    window.localStorage.setItem(this.localStorageKey, JSON.stringify(this.localConfig));
};

EHentaiDownloadHelperConfig.prototype.loadDownloadedGalleriesFromCF = function() {
    let that = this;
    async function getJSON(url) {
        const response = await fetch(url);
        return response.json();
    }

    getJSON("https://gallery-file-lookup.pbxg33k.workers.dev/").then(data => {

        console.log(data.results);
        data.result.forEach(gallery => {
            //console.log(gallery.gid);
            if(!this.isGalleryDownloaded({id: gallery.gid})) {
                this.addGalleryToHistory({id: gallery.gid.toString()}, function() {
                    console.log('Added gallery from CF to db');
                });
            }
        });
    });
}

EHentaiDownloadHelperConfig.prototype.addGalleryToHistory = function (gallery, callback) {
    if (!this.isGalleryDownloaded(gallery)) {
        this.localConfig.history.push(gallery.id);
        this.storeConfig();
    }
    callback();
};

EHentaiDownloadHelperConfig.prototype.isGalleryDownloaded = function (gallery) {
    return this.localConfig.history.indexOf(parseInt(gallery.id).toString()) !== -1;
};

EHentaiDownloadHelperConfig.prototype.loadConfig = function () {
    if (window.localStorage.getItem(this.localStorageKey) !== null) {
        this.localConfig = JSON.parse(window.localStorage.getItem(this.localStorageKey));
    }
};

function EHentaiApiHelper(parent) {
    this.parent = parent;
    this.i = 0;
}

EHentaiApiHelper.prototype = {};
EHentaiApiHelper.prototype.galleryQueue = [];

EHentaiApiHelper.prototype.addGalleryToMetaQueue = function (gallery) {
    const that = this;
    this.lookForGalleryInCache(gallery, function (dbentry) {
        that.i++;
        if (typeof (dbentry) === "undefined") {
            that.galleryQueue.push(gallery);
        }
        else {
            that.parent.galleries[dbentry.id] = dbentry;
        }
        if (that.parent.galleryCount === that.i) {
            that.sendMetaRequest(that);
        }
    }, function (error) {
        that.i++;
        console.log('DBERROR adding to metaqueue: ' + error);
        that.galleryQueue.push(gallery);
        if (that.parent.galleryCount === that.i) {
            that.sendMetaRequest(that);
        }
    });
};

EHentaiApiHelper.prototype.lookForGalleryInCache = function (gallery, onsuccess, onerror) {
    this.parent.Cache.galleryCacheGet(gallery.id, function (dbentry) {
        onsuccess(dbentry);
    }, function (error) {
        console.log('[DB Error]: ' + error);
        onerror(error);
    })
};

EHentaiApiHelper.prototype.sendMetaRequest = function (that) {
    // Split up calls by gallery limit
    let i, j;

    const apiUri = 'https://api.e-hentai.org/api.php';
    const xhr = new XMLHttpRequest();

    if (this.galleryQueue.length > 0) {
        for (i = 0, j = this.galleryQueue.length; i < j; i += this.parent.Config.apiConfig.limits.galleries) {
            // @todo add a wait

            let apiArray = [];

            this.galleryQueue.slice(i, i + this.parent.Config.apiConfig.limits.galleries).forEach(function (item) {
                this.push([item.id, item.token]);
            }, apiArray);

            xhr.open('POST', apiUri, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function () {
                if (this.readyState !== 4) return;

                if (this.status === 200) {
                    const data = JSON.parse(this.responseText);

                    data.gmetadata.forEach(function (item) {
                        that.parent.galleries[item.gid].metadata = item;
                        that.parent.Cache.galleryCacheSet(that.parent.galleries[item.gid], function (event) {}, function (error) {
                            console.log('DBERROR in API: ' + error);
                        });
                    }, window.GalleryDownloadHelper);
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

function Gallery(parent) {
    this.parent = parent;
}

Gallery.prototype = {};
Gallery.prototype.fromCache = function (gallery) {
    this.id = gallery.id;
    this.token = gallery.token;
    this.name = gallery.name;
    this.uri = gallery.uri;
    this.metadata = gallery.metadata;
    this.timestamp = gallery.timestamp;
    return this;
};
Gallery.prototype.fromThumbnailView = function (element) {
    const extractedData = this.extractDataFromGalleryURI(element.children[0].attributes.href.value);
    this.id = extractedData.id;
    this.token = extractedData.token;
    this.name = element.children[0].children[0].textContent.trim();
    this.uri = element.children[0].attributes.href.value;
    this.timestamp = new Date(Date.now());
    return this;
};
Gallery.prototype.fromListView = function (element) {
    let infoElement = element.getElementsByClassName('gl3m glname')[0].children[0];
    this.name = infoElement.textContent;

    const extractedData = this.extractDataFromGalleryURI(infoElement.attributes['href'].value);
    this.id = extractedData.id;
    this.token = extractedData.token;
    return this;
};
Gallery.prototype.downloadArchive = function () {
    if (typeof this.metadata !== "undefined") {
        popUp(`${this.parent.Config.archiverUri}?gid=${this.id}&token=${this.token}&or=${this.metadata.archiver_key}`, 480, 320);
    }
};
Gallery.prototype.loadMetadataFromApi = function () {
    this.parent.API.addGalleryToMetaQueue(this);
    this.parent.API.sendMetaRequest();
};
Gallery.prototype.extractDataFromGalleryURI = function (uri) {
    function returnObj(uri) {
        const data = uri.match(/https?:\/\/e-hentai\.org\/g\/([0-9]+)\/([0-9a-fA-F]+)\/?/);

        this.id = data[1];
        this.token = data[2];

        return this;
    };

    return new returnObj(uri);
};
Gallery.prototype.toJSON = function () {
    return {
        id: this.id,
        token: this.token,
        name: this.name,
        uri: this.uri,
        timestamp: this.timestamp,
        metadata: this.metadata
    }
};

function EHExchange(parent) {
    console.debug('Initializing EHExchange');
    this.parent = parent;
}

EHExchange.prototype = {};
EHExchange.prototype.init = function() {
    this.addCalculationsToPage(
        this.calculateBuySellOptions(
            this.getAvailable(),
            this.loadPrices()
        )
    )
}

EHExchange.prototype.getAvailable = function() {
    return {
        credits: this.getPriceNumericValue(document.querySelector("body > div.stuffbox > div:nth-child(3) > div:nth-child(1) > div:nth-child(3)").innerText),
        secondcurrency: this.getPriceNumericValue(document.querySelector("body > div.stuffbox > div:nth-child(3) > div:nth-child(2) > div:nth-child(3)").innerText),
    }
}

EHExchange.prototype.loadPrices = function() {
    return {
        low: this.getPriceNumericValue(document.querySelector("body > div.stuffbox > div:nth-child(4) > div:nth-child(1) > div:nth-child(2) > table > tbody > tr:nth-child(1) > td:nth-child(3)").innerText),
        high: this.getPriceNumericValue(document.querySelector("body > div.stuffbox > div:nth-child(4) > div:nth-child(1) > div:nth-child(3) > table > tbody > tr:nth-child(1) > td:nth-child(3)").innerText)
    }
}

EHExchange.prototype.calculateBuySellOptions = function(available, prices) {
    return {
        buy: {
            low: {
                amount: Math.floor(available.credits / prices.low),
                price: prices.low
            },
            low_overbid: {
                amount: Math.floor(available.credits / ( prices.low + 1 )),
                price: prices.low + 1
            },
            high: {
                amount: Math.floor(available.credits / prices.high),
                price: prices.high
            },
            high_underprice: {
                amount: Math.floor(available.credits / (prices.high - 1 )),
                price: prices.high - 1
            }
        },
        sell: {
            low: {
                amount: available.secondcurrency,
                price: prices.low,
                totalprofit: available.secondcurrency * prices.low
            },
            low_overbid: {
                amount: available.secondcurrency,
                price: prices.low + 1,
                totalprofit: available.secondcurrency * (prices.low + 1)
            },
            high: {
                amount: available.secondcurrency,
                price: prices.high,
                totalprofit: available.secondcurrency * prices.high
            },
            high_underprice: {
                amount: available.secondcurrency,
                price: prices.high - 1,
                totalprofit: available.secondcurrency * (prices.high - 1)
            }
        }
    }
}

EHExchange.prototype.getPriceNumericValue = function(text) {
    regex = /.*?([\d,]+)\s.*/;
    return parseInt(text.match(regex)[1].replace(/\,/g,''));
}

EHExchange.prototype.addCalculationsToPage = function(calculations) {
    document.querySelector("body > div.stuffbox > div:nth-child(3) > div:nth-child(1)").append(this.generatePriceBlock(calculations,'buy'));
    document.querySelector("body > div.stuffbox > div:nth-child(3) > div:nth-child(2)").append(this.generatePriceBlock(calculations, 'sell'));
}

EHExchange.prototype.generatePriceBlock = function(prices, action) {
    documentFragment = document.createDocumentFragment();
    
    documentFragment.appendChild(this.generatePriceInnerBlock(prices[action].low, action));
    documentFragment.appendChild(this.generatePriceInnerBlock(prices[action].high, action));
    documentFragment.appendChild(this.generatePriceInnerBlock(prices[action].low_overbid, action));
    documentFragment.appendChild(this.generatePriceInnerBlock(prices[action].high_underprice, action));

    return documentFragment;
}

EHExchange.prototype.generatePriceInnerBlock = function(calculation, action) {
    element = document.createElement('div');
    element.style.display = 'grid';
    element.style.width = '50%';
    element.style.float = 'left';

    element.innerText = action + " " + calculation.amount + " @ " + calculation.price + " C";

    if(action === "buy") {
        element.onclick = function() {
            document.getElementById('bid_count').value = calculation.amount.toString();
            document.getElementById('bid_price').value = calculation.price.toString();
        }
    } else if(action === "sell") {
        element.innerText = element.innerText + " (" + calculation.totalprofit + " C)";
        element.onclick = function() {
            document.getElementById('ask_count').value = calculation.amount.toString();
            document.getElementById('ask_price').value = calculation.price.toString();
        }
    }

    return element;
}

function GalleryDownloadHelper() {
    console.debug('Initializing GalleryDownloadHelper');
    this.API = new EHentaiApiHelper(this);
    this.Config = new EHentaiDownloadHelperConfig(this);
    this.Cache = new EHentaiDownloadHelperCache(this);
    this.EHExchange = new EHExchange(this);
    this.galleries = [];
    this.init();
}

GalleryDownloadHelper.prototype = {};
GalleryDownloadHelper.prototype.init = function () {
    // Check if we're browsing the site or trying to download a gallery
    if(window.location.href.indexOf('archiver.php?') != -1) {
        this.autoDownloader();
    } else if (window.location.href.indexOf('exchange.php') != -1) {
        this.EHExchange.init();
    } else {
        this.loadGalleries();
    }
};
GalleryDownloadHelper.prototype.autoDownloader = function () {
    const that = this;
    if(document.getElementsByTagName('strong')[0].textContent.trim() === 'Free!') {
        document.getElementsByName('dlcheck').forEach(function(el) {
            // Get galleryId before hitting download (and leaving script env)
            that.Cache.galleryCacheGet(that.getGalleryIdFromArchiverUrl(window.location.href), function(dbentry) {
                that.Config.addGalleryToHistory(dbentry, function() {
                    if(el.value === "Download Original Archive") {
                        el.click();
                    }
                });
            });
        });
    } else {
        let galleryMarked = false;
        // Override submit buttons to update download state
        document.getElementsByName('dlcheck').forEach(function (el) {
            el.form.onsubmit = function(event) {
                if(!galleryMarked) {
                    event.preventDefault();
                    that.Cache.galleryCacheGet(that.getGalleryIdFromArchiverUrl(window.location.href), function (dbentry) {
                        that.Config.addGalleryToHistory(dbentry, function () {
                            galleryMarked = true;
                            el.click();
                        });
                    });
                }
            };
        });
    }
};
GalleryDownloadHelper.prototype.getGalleryIdFromArchiverUrl = function(url) {
    let regExpMatchArray = url.match(/\?gid=(\d+)/);
    return regExpMatchArray[1];
};
GalleryDownloadHelper.prototype.loadGalleries = function () {
    // Detect if we're in list or thumbnailview
    switch (document.getElementById('dms').children[0].children[0].children[document.getElementById('dms').children[0].children[0].selectedIndex].value) {
        case 't': // Thumbnail
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

    if(this.Config.cloudFlare.enabled) {
        this.Config.loadDownloadedGalleriesFromCF();
    }

    this.setStorageEventListeners();
};
GalleryDownloadHelper.prototype.loadGalleriesFromThumbnailView = function () {
    let that = this;
    this.loopGalleryElements(document.getElementsByClassName('gl1t'), function (element) {
        let gallery = new Gallery(that).fromThumbnailView(element);
        that.galleries[gallery.id] = gallery;
        that.appendDownloadButtonToThumbnailView(element, gallery);
    });
};
GalleryDownloadHelper.prototype.addColumnToTableView = function () {
    let table = document.getElementsByClassName('itg gltm')[0];

    table.tBodies[0].rows[0].children[3].colSpan = 2;
};
GalleryDownloadHelper.prototype.loadGalleriesFromListView = function () {
    this.addColumnToTableView();
    let that = this;
    const elements = document.getElementsByClassName('itg gltm')[0].children[0].children;
    elements.shift(); // Remove first element (table header)

    this.loopGalleryElements(elements, function (element) {
        let gallery = new Gallery().fromListView(element);
        that.galleries[gallery.id] = gallery;
        that.appendDownloadButtonToListView(element, gallery);
    });
};
GalleryDownloadHelper.prototype.loopGalleryElements = function (elements, galleryCreationCallback) {
    this.galleryCount = elements.length;
    for (let i = 0; i < this.galleryCount; i++) {
        galleryCreationCallback(elements[i]);
    }
};
GalleryDownloadHelper.prototype.appendDownloadButtonToThumbnailView = function (element, gallery) {
    let target = element.getElementsByClassName('gl6t')[0];
    if (typeof target === "undefined") {
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
    const button = document.createElement('div');
    button.className = 'gt hack';
    button.gallery = gallery;

    this.setDownloadStateStyle(button, gallery.id, this.Config.isGalleryDownloaded(gallery));

    return button;
};
GalleryDownloadHelper.prototype.setDownloadStateStyle = function (element, id, downloaded) {
    const colors = {
        notDownloaded: {
            color: '#f1f1f1',
            border: '#dd13df',
            gradient: '#dd13df,#d954da',
            text: 'Download Archive'
        },
        downloaded: {
            color: '#000000',
            border: '#1edf13',
            gradient: '#1edf13,#5cda54',
            text: 'Downloaded'
        }
    };

    let state = downloaded === true ? 'downloaded' : 'notDownloaded';

    element.style = `border-color: ${colors[state].border};background: radial-gradient(${colors[state].gradient}) !important; text-align: center`;
    element.innerHTML = `<a href="#" style="color:${colors[state].color}" data-id="${id}" onclick="GalleryDownloadHelper.downloadArchive(this); return false" >${colors[state].text}</a>`;
};
GalleryDownloadHelper.prototype.setStorageEventListeners = function () {
    let that = this;

    window.addEventListener('storage', function (e) {
        if(e.key === "EhentaiDownloadHelper") {
            that.arrayDiff(JSON.parse(e.oldValue).history, JSON.parse(e.newValue).history).forEach(function(element) {
                document.querySelectorAll("[data-id=\""+element+"\"]").forEach(function(el) {
                    that.setDownloadStateStyle(el.parentElement, element, true);
                })
            })
        }
    });
};
// Credit https://stackoverflow.com/a/1187628/1665706
GalleryDownloadHelper.prototype.arrayDiff = function (a1, a2) {
    var a = [], diff = [];

    for (var i = 0; i < a1.length; i++) {
        a[a1[i]] = true;
    }

    for (var i = 0; i < a2.length; i++) {
        if (a[a2[i]]) {
            delete a[a2[i]];
        } else {
            a[a2[i]] = true;
        }
    }

    for (var k in a) {
        diff.push(k);
    }

    return diff;
};
GalleryDownloadHelper.prototype.downloadArchive = function (element) {
    let Gallery = this.galleries[element.attributes['data-id'].value];

    Gallery.downloadArchive();
};

let gdh = new GalleryDownloadHelper();
Window.prototype.GalleryDownloadHelper = gdh;
