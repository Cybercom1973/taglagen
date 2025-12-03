// --- HJÄLPFUNKTIONER ---

function escapeXml(str) {
    if (! str) return '';
    return String(str). replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[m]));
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr);
}

function getDiffMinutes(advertisedStr, actualStr) {
    const adv = parseDate(advertisedStr);
    const act = parseDate(actualStr);
    if (!adv || ! act) return 0;
    return Math.round((act - adv) / 60000);
}

function formatDelay(diff) {
    if (isNaN(diff) || diff === 0) return 'I tid';
    return (diff > 0 ? '+' : '') + diff + ' min';
}

// Robust funktion för att hitta destination
function getBestDestination(ann) {
    if (ann.ToLocation && ann.ToLocation. length > 0) {
        return ann.ToLocation[0].LocationName;
    }
    if (ann.ViaToLocation && ann.ViaToLocation.length > 0) {
        return ann. ViaToLocation[ann.ViaToLocation.length - 1].LocationName;
    }
    return "? ";
}

// Hitta destination för ett tåg från alla dess announcements
function findTrainDestination(trainId, allAnnouncements) {
    const trainAnns = allAnnouncements.filter(ann => 
        (ann.TechnicalTrainIdent || ann.AdvertisedTrainIdent) === trainId ||
        ann. AdvertisedTrainIdent === trainId
    );
    
    for (const ann of trainAnns) {
        const dest = getBestDestination(ann);
        if (dest !== "?") return dest;
    }
    return "?";
}

// Hitta slutstation för ditt tåg (för rubriken)
function findDestinationSignature(announcements) {
    for (const ann of announcements) {
        const dest = getBestDestination(ann);
        if (dest !== "?") return dest;
    }
    return "?";
}

// Hitta ursprungsstation för ditt tåg
function findOriginSignature(announcements) {
    for (const ann of announcements) {
        if (ann.FromLocation && ann.FromLocation. length > 0) {
            return ann.FromLocation[0].LocationName;
        }
    }
    return announcements. length > 0 ? announcements[0].LocationSignature : "?";
}

// --- BYGG RUTT ---
function buildRoute(announcements) {
    if (! announcements || announcements.length === 0) return [];

    const stationMap = new Map();

    announcements.forEach(ann => {
        if (!stationMap. has(ann.LocationSignature)) {
            stationMap. set(ann.LocationSignature, {
                signature: ann.LocationSignature,
                isAnnounced: false,
                advertised: null,
                actual: null,
                track: null,
                sortTime: 0,
                technicalIdent: null
            });
        }
        
        const node = stationMap. get(ann.LocationSignature);

        if (ann. Advertised === true) node.isAnnounced = true;

        if (ann. AdvertisedTimeAtLocation) {
            const t = parseDate(ann.AdvertisedTimeAtLocation). getTime();
            if (node.sortTime === 0 || ann.ActivityType === 'Avgang') {
                node.sortTime = t;
                node.advertised = ann. AdvertisedTimeAtLocation;
            }
        }

        if (ann. TimeAtLocation) node.actual = ann.TimeAtLocation;
        if (ann.TrackAtLocation) node.track = ann.TrackAtLocation;
        if (ann.TechnicalTrainIdent) node.technicalIdent = ann.TechnicalTrainIdent;
    });

    const route = Array.from(stationMap.values());
    route.sort((a, b) => a. sortTime - b. sortTime);

    return route. reverse();
}

// --- HUVUDPROGRAM ---

$(document).ready(function() {
    const urlParams = new URLSearchParams(window. location.search);
    const trainNumber = urlParams.get('train');

    if (trainNumber) {
        loadTrain(trainNumber, false);
        setInterval(() => loadTrain(trainNumber, true), 60000);
        $('#refresh-btn'). off('click').on('click', () => loadTrain(trainNumber, true));
    } else {
        $('#train-label').text('Inget tåg valt');
    }
});

function loadTrain(trainNumber, isRefresh = false) {
    if (! isRefresh) {
        $('#loading').show();
        $('#train-table'). hide();
    }
    $('#error-message').hide();
    
    const safeTrainNum = escapeXml(trainNumber);
    
    TrafikverketAPI.getTrainAnnouncements(safeTrainNum)
        .then(data => {
            if (! data || ! data. RESPONSE || !data. RESPONSE. RESULT || !data.RESPONSE.RESULT[0]) {
                throw new Error("Ogiltigt svar från Trafikverket.");
            }

            const resultItem = data.RESPONSE.RESULT[0];
            const announcements = resultItem. TrainAnnouncement || [];
            
            if (announcements.length === 0) {
                const today = new Date().toLocaleDateString('sv-SE');
                throw new Error(`Inga tåg hittades med nummer ${trainNumber} för datum ${today}.`);
            }
            
            const techIdent = announcements[0].TechnicalTrainIdent || trainNumber;
            $('#train-label').text('Tåg ' + techIdent);
            
            const route = buildRoute(announcements);
            const signatures = route.map(r => r.signature);
            const myDestSig = findDestinationSignature(announcements);
            const myFromSig = findOriginSignature(announcements);

            const routeTrainsPromise = TrafikverketAPI.getOtherTrains(signatures);
            const lineTrainsPromise = TrafikverketAPI.getTrainsOnLine(myFromSig, myDestSig);

            return Promise.all([routeTrainsPromise, lineTrainsPromise]). then(([routeData, lineData]) => {
                let otherTrains = [];
                
                if (routeData && routeData. RESPONSE && routeData.RESPONSE. RESULT && routeData.RESPONSE. RESULT[0]) {
                    otherTrains = routeData.RESPONSE. RESULT[0]. TrainAnnouncement || [];
                }
                
                if (lineData && lineData.RESPONSE && lineData.RESPONSE.RESULT && lineData.RESPONSE. RESULT[0]) {
                    const lineTrains = lineData.RESPONSE. RESULT[0]. TrainAnnouncement || [];
                    const getTrainKey = t => `${t. AdvertisedTrainIdent}-${t. LocationSignature}-${t.ActivityType}`;
                    const existingIds = new Set(otherTrains.map(getTrainKey));
                    
                    lineTrains.forEach(t => {
                        const id = getTrainKey(t);
                        if (!existingIds.has(id)) {
                            otherTrains. push(t);
                            existingIds.add(id);
                        }
                    });
                }
                
                const scrollPos = window.scrollY;
                
                renderTable(route, otherTrains, trainNumber, myDestSig, isRefresh);
                
                if (isRefresh) {
                    window.scrollTo(0, scrollPos);
                }
                
                $('#loading'). hide();
                $('#train-table').show();
                $('#last-update').text('Uppdaterad: ' + new Date(). toLocaleTimeString('sv-SE'));
            });
        })
        .catch(err => {
            $('#loading').hide();
            $('#error-message').text(err.message). show();
            console.error(err);
        });
}

function renderTable(route, otherTrains, mySearchIdent, myDestSig, isRefresh = false) {
    const $tbody = $('#table-body');
    $tbody.empty();
    
    let currentPosIndex = -1;
    let dynamicTechnicalIdent = mySearchIdent;

    for (let i = 0; i < route.length; i++) {
        if (route[i].actual) {
            currentPosIndex = i;
            if (route[i]. technicalIdent) dynamicTechnicalIdent = route[i].technicalIdent;
            break; 
        }
    }
    $('#train-label').text('Tåg ' + dynamicTechnicalIdent);

    const routeIndexMap = new Map();
    route.forEach((node, idx) => {
        routeIndexMap.set(node.signature, idx);
    });

    const now = new Date();
    const latestMap = new Map();

    otherTrains.forEach(t => {
        if (t. AdvertisedTrainIdent === mySearchIdent) return;
        if (! t.TimeAtLocation) return;
        
        const id = t.TechnicalTrainIdent || t. AdvertisedTrainIdent;
        const newTime = parseDate(t.TimeAtLocation). getTime();
        
        if (!latestMap.has(id) || newTime > parseDate(latestMap.get(id). TimeAtLocation). getTime()) {
            latestMap. set(id, t);
        }
    });
    
    const activeOtherTrains = [];
    const hideStationaryMinutes = parseInt(localStorage.getItem('taglaget_hideStationaryMinutes')) || 30;
    const hideDepartedMinutes = parseInt(localStorage.getItem('taglaget_hideDepartedMinutes')) || 15;

    latestMap. forEach(t => {
    const ageMinutes = Math. abs((now - parseDate(t.TimeAtLocation)) / 60000);
    
    if (t.ActivityType === 'Avgang' && ageMinutes > hideDepartedMinutes) return;
    if (t.ActivityType === 'Ankomst' && ageMinutes > hideStationaryMinutes) return;
    
    // Hitta destination från alla announcements för detta tåg
    const trainId = t.TechnicalTrainIdent || t.AdvertisedTrainIdent;
    let dest = getBestDestination(t);
    if (dest === "? ") {
        dest = findTrainDestination(trainId, otherTrains);
    }
    
    // Dölj tåg som har ankommit till sin slutstation
    if (t.ActivityType === 'Ankomst' && t.LocationSignature === dest) return;

    activeOtherTrains. push(t);
});

    const routeSignatures = new Set(route.map(r => r. signature));
    const missingStations = new Map();

    activeOtherTrains. forEach(t => {
        const sig = t.LocationSignature;
        if (!routeSignatures.has(sig) && !missingStations.has(sig)) {
            missingStations.set(sig, {
                signature: sig,
                isAnnounced: false,
                advertised: t.AdvertisedTimeAtLocation,
                actual: t. TimeAtLocation,
                track: t. TrackAtLocation,
                sortTime: parseDate(t.TimeAtLocation).getTime(),
                technicalIdent: null,
                isExternalStation: true
            });
        }
    });

    let displayRoute = route;
    if (missingStations.size > 0) {
        const allStations = [... route, ...missingStations.values()];
        allStations.sort((a, b) => b.sortTime - a.sortTime);
        displayRoute = allStations;
        
        currentPosIndex = displayRoute.findIndex(s => 
            route.find(r => r. signature === s.signature && r.actual)
        );
        if (currentPosIndex === -1) {
            for (let i = 0; i < displayRoute.length; i++) {
                if (displayRoute[i].actual && ! displayRoute[i]. isExternalStation) {
                    currentPosIndex = i;
                    break;
                }
            }
        }
    }

    const maxStations = parseInt(localStorage.getItem('taglaget_maxStations')) || 0;

    if (maxStations > 0 && currentPosIndex >= 0) {
        const halfWindow = Math.floor(maxStations / 2);
        let startIdx = Math.max(0, currentPosIndex - halfWindow);
        let endIdx = Math.min(displayRoute.length, startIdx + maxStations);
        
        if (endIdx === displayRoute.length) {
            startIdx = Math.max(0, endIdx - maxStations);
        }
        
        displayRoute = displayRoute.slice(startIdx, endIdx);
        currentPosIndex = currentPosIndex - startIdx;
    }

    displayRoute.forEach((station, index) => {
        
        if (index === currentPosIndex && index > 0) {
            const $spacer = $('<tr>'). addClass('spacer-row');
            const $td = $('<td>').attr('colspan', '3');
            const diff = getDiffMinutes(station.advertised, station.actual);
            const colorClass = diff > 0 ? 'delayed' : 'on-time';
            const $myTrain = $('<div>').addClass('current-train-box');
            $myTrain.html(`⬆ ${dynamicTechnicalIdent} ${myDestSig} <span class="${colorClass}">(${formatDelay(diff)})</span> ⬆`);
            $td.append($myTrain);
            $spacer.append($td);
            $tbody.append($spacer);
        }

        const $row = $('<tr>');
        const $stationCell = $('<td>').addClass('station-cell');
        const encodedSign = encodeURIComponent(station.signature);
        const $link = $('<a>')
            .attr('href', `https://search.stationen.info/station.html?sign=${encodedSign}`)
            .addClass('station-link')
            .text(station.signature);
        
        $stationCell.append($link);
        if (! station.isAnnounced) $stationCell.addClass('unannounced-station');
        if (station.isExternalStation) $stationCell.addClass('external-station');
        if (index === currentPosIndex && index === 0) $stationCell.addClass('current-position-glow');
        $row.append($stationCell);
        
        const trainsHere = activeOtherTrains.filter(t => t. LocationSignature === station.signature);
        const sameDirectionTrains = [];
        const meetingTrains = [];

        trainsHere.forEach(t => {
            let isSameDir = false; 
            let isDiverging = false;

            let targets = [];
            if (t.ToLocation) t.ToLocation.forEach(l => targets.push(l. LocationName));
            if (t.ViaToLocation) t.ViaToLocation.forEach(l => targets.push(l.LocationName));
            const fallbackDest = getBestDestination(t);
            if (fallbackDest !== "? ") targets.push(fallbackDest);

            let origins = [];
            if (t.FromLocation) t.FromLocation.forEach(l => origins.push(l.LocationName));
            if (t. ViaFromLocation) t.ViaFromLocation.forEach(l => origins.push(l.LocationName));

            const goingToMyFuture = targets.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx < index;
            });

            const comingFromMyPast = origins.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx > index;
            });

            const goingToMyPast = targets.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx > index;
            });

            const comingFromMyFuture = origins.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx < index;
            });

            const trainId = t.TechnicalTrainIdent || t. AdvertisedTrainIdent;
            const allTrainAnnouncements = otherTrains.filter(ot => 
                (ot.TechnicalTrainIdent || ot. AdvertisedTrainIdent) === trainId && ot.TimeAtLocation
            );
            
            const hasPassedMyPast = allTrainAnnouncements. some(ann => {
                const idx = routeIndexMap. get(ann.LocationSignature);
                return idx !== undefined && idx > index;
            });
            
            const hasPassedMyFuture = allTrainAnnouncements.some(ann => {
                const idx = routeIndexMap.get(ann.LocationSignature);
                return idx !== undefined && idx < index;
            });

            if (goingToMyFuture) {
                isSameDir = true;
            } else if (goingToMyPast) {
                isSameDir = false;
            } else if (comingFromMyFuture) {
                isSameDir = false;
            } else if (comingFromMyPast) {
                isSameDir = true;
                isDiverging = true;
            } else if (hasPassedMyPast && ! hasPassedMyFuture) {
                isSameDir = true;
            } else if (hasPassedMyFuture && !hasPassedMyPast) {
                isSameDir = false;
            } else if (hasPassedMyPast && hasPassedMyFuture) {
                const sortedAnns = allTrainAnnouncements
                    .filter(ann => routeIndexMap.has(ann.LocationSignature))
                    .sort((a, b) => parseDate(b.TimeAtLocation) - parseDate(a.TimeAtLocation));
                
                if (sortedAnns.length > 0) {
                    const latestIdx = routeIndexMap.get(sortedAnns[0].LocationSignature);
                    isSameDir = latestIdx > index;
                }
            } else {
                if (targets.includes(myDestSig)) isSameDir = true;
                else isSameDir = false;
            }

            t._isDiverging = isDiverging;

            if (isSameDir) sameDirectionTrains.push(t);
            else meetingTrains.push(t);
        });

        const $sameDirCell = $('<td>').addClass('same-direction-cell');
        sameDirectionTrains.forEach(t => $sameDirCell. append(createTrainElement(t, otherTrains)));

        if (index === currentPosIndex && index === 0) {
            const diff = getDiffMinutes(station.advertised, station.actual);
            const colorClass = diff > 0 ? 'delayed' : 'on-time';
            const $myTrain = $('<div>').addClass('current-train-box');
            $myTrain.html(`🏁 ${dynamicTechnicalIdent} ${myDestSig} <span class="${colorClass}">(${formatDelay(diff)})</span>`);
            $sameDirCell.append($myTrain);
        }
        $row.append($sameDirCell);

        const $meetDirCell = $('<td>').addClass('meeting-cell');
        meetingTrains.forEach(t => $meetDirCell.append(createTrainElement(t, otherTrains)));
        $row.append($meetDirCell);
        
        $tbody.append($row);
    });
    
    if (currentPosIndex >= 0 && !isRefresh) {
        setTimeout(() => {
            const $target = $('.spacer-row'). length ? $('.spacer-row') : $('#table-body tr'). eq(0);
            if ($target.length) $target[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

function createTrainElement(t, allAnnouncements) {
    const id = t.TechnicalTrainIdent || t.AdvertisedTrainIdent;
    const searchId = t. AdvertisedTrainIdent;
    const diff = getDiffMinutes(t. AdvertisedTimeAtLocation, t.TimeAtLocation);
    const colorClass = diff > 0 ?  'delayed' : 'on-time';
    
    let dest = getBestDestination(t);
    if (dest === "?" && allAnnouncements) {
        dest = findTrainDestination(id, allAnnouncements);
    }
    
    if (dest !== "? ") dest = " " + dest;
    else dest = "";
    
    const divergeIcon = t._isDiverging ? " ↱" : "";

    const $div = $('<div>').addClass('train-item');
    const $link = $('<a>').attr('href', `? train=${searchId}`).text(id + dest + divergeIcon);
    
    $div.append($link);
    $div.append(` <span class="${colorClass}">(${formatDelay(diff)})</span>`);
    
    return $div;
}