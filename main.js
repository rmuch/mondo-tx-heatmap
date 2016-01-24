"use strict";

class CredentialStorage {
    getUrlBase() {
        return localStorage.getItem("mondo_tx_map_url_base") || "https://staging-api.getmondo.co.uk";
    }

    setUrlBase(v) {
        localStorage.setItem("mondo_tx_map_url_base", v);
    }

    getAccessToken() {
        return localStorage.getItem("mondo_tx_map_token");
    }

    setAccessToken(v) {
        localStorage.setItem("mondo_tx_map_token", v);
    }
}

class MondoApi {
    constructor(urlBase, accessToken) {
        this.urlBase = urlBase;
        this.token = accessToken;
    }

    getAccounts() {
        var endpoint = "/accounts";

        var _this = this;

        return new Promise(function (f, r) {
            $.ajax({
                method: 'GET',
                url: _this.urlBase + endpoint,
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + _this.token);
                }
            }).done(function (result) {
                f(result);
            });
        });
    }

    getAllTransactions(accountId) {
        var endpoint = "/transactions";

        var _this = this;

        return new Promise(function (f, r) {
            $.ajax({
                method: 'GET',
                url: _this.urlBase + endpoint,
                data: {
                    account_id: accountId,
                    expand: ['merchant']
                },
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + _this.token);
                }
            }).done(function (result) {
                f(result);
            });
        });
    }
}

var transactionToPoint = function (transaction, valueWeighted, timeWeighted) {
    if (valueWeighted === undefined)
        valueWeighted = false;

    if (timeWeighted === undefined)
        timeWeighted = false;

    if (!transaction.merchant || !transaction.merchant.address)
        return null;

    var lat = transaction.merchant.address.latitude;
    var lon = transaction.merchant.address.longitude;
    var valueWeight = Math.abs(transaction.amount);

    var tDelta = Date.now() - Date.parse(transaction.created);

    var timeWeight = tDelta;

    console.log(`txn: ${transaction.id} lat: ${lat} lon: ${lon} vw: ${valueWeight} tw: ${timeWeight}`)

    if (valueWeighted) {
        return {location: new google.maps.LatLng(lat, lon), weight: valueWeight};
    }

    if (timeWeighted) {
        return {location: new google.maps.LatLng(lat, lon), weight: timeWeight};
    }

    return new google.maps.LatLng(lat, lon);
};

var getTransactionsOnly = function () {
    return new Promise(function (f, r) {
        var cs = new CredentialStorage();
        var api = new MondoApi(cs.getUrlBase(), cs.getAccessToken());

        var accountsPromise = api.getAccounts();
        accountsPromise.then(function (result) {
            var id = _(result.accounts).chain().map(acc => acc.id).first().value();
            console.log("ID:" + id);

            var transactionsPromise = api.getAllTransactions(id);
            transactionsPromise.then(function (response) {
                console.log("TXNS: " + JSON.stringify(response, null, 4));

                f(response);
            }).catch(function(e){r(e)});
        });
    });
};

var map, heatmap;

function initMap2() {
    var styledMap = new google.maps.StyledMapType(lightGreyStyle,
        {name: "Styled Map"});

    // TODO: Calculate based on something like most concentrated area of transactions.
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 13,
        center: {lat: 51.5, lng: -0.11},
        mapTypeId: google.maps.MapTypeId.SATELLITE
    });

    map.mapTypes.set('map_style', styledMap);
    map.setMapTypeId('map_style');
}

var cachedTransactions = null;

function loadTransactionsOnce() {
    getTransactionsOnly().then(function (s) {
        cachedTransactions = s;
    }).then(function() {
        reloadMapData();
    })
}

var excludeCategories = [];
var isWeighted = false;
var isTimeDecay = false;

var getPoints = function (response) {
    return new Promise(function (f, r) {
        console.log("TXNS: " + JSON.stringify(response, null, 4));

        var points = _(response.transactions)
            .chain()
            .filter(t => !t.is_load)
            .filter(t => {
                if (t.merchant && t.merchant.category) {
                    console.log("checking if excludeCategories contains " + t.merchant.categorys)
                    return !_.contains(excludeCategories, t.merchant.category);
                } else {
                    return true;
                }
            })
            .map(t => transactionToPoint(t, isWeighted, isTimeDecay))
            .filter(t => t != null)
            .value();

        f(points);
    });
};

function reloadMapData() {
    console.log(`reloadMapData() (cachedtransactions is null: ${cachedTransactions == null}`)
    if (cachedTransactions == null) {
        loadTransactionsOnce();
    } else {
        var pts = getPoints(cachedTransactions).then(function (r) {
            if (heatmap) heatmap.setMap(null);

            heatmap = new google.maps.visualization.HeatmapLayer({
                data: r,
                map: map
            });
        });
    }
}

function initJq() {
    var categories = ['general', 'eating_out', 'expenses', 'transport', 'cash', 'bills', 'entertainment', 'shopping', 'holidays', 'groceries'];

    var catSelectors = {};
    categories.forEach(category => {
        console.log(`setting up hooks for ${category}`);

        var selector = $("#" + category + "_onoff");

        selector.change(function () {
            var thisCategory = category;
            var isChecked = $(this).is(":checked");

            console.log(`${thisCategory} changed to ${isChecked}`)

            if (!isChecked) {
                excludeCategories = [...excludeCategories, thisCategory];
            } else {
                excludeCategories = _(excludeCategories).without(thisCategory);
            }

            console.log(`exclude categories: ${excludeCategories}`);

            reloadMapData();
        });

        catSelectors[category] = selector;
    });

    $("#opt_weighted_onoff").change(function () {
        isWeighted = $(this).is(":checked");

        reloadMapData();
    });

    $("#opt_decay_onoff").change(function () {
        isTimeDecay = $(this).is(":checked");

        reloadMapData();
    });

    var credentialStorage = new CredentialStorage();
    var apiUrlBox = $('#apiurlbox');
    var sandboxKeyBox = $('#sandboxkeybox');

    apiUrlBox.val(credentialStorage.getUrlBase());
    sandboxKeyBox.val(credentialStorage.getAccessToken());

    $('#continue_btn').click(function () {
        $('.hidebg').hide();
        $('.authpopup').hide();

        credentialStorage.setUrlBase(apiUrlBox.val());
        credentialStorage.setAccessToken(sandboxKeyBox.val());

        loadTransactionsOnce();
    });
}
