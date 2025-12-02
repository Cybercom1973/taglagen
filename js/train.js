$(document).ready(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const trainNumber = urlParams.get('train');
    
    if (!trainNumber) {
        showError('Inget tågnummer angivet');
        return;
    }

    let myTrainPosition = null;
    let myTrainBearing = null;
    let myTrainSpeed = null;
    let refreshInterval = null;
    let scrollPos = 0;

    // Hjälpfunktioner
    function parseDate(dateStr) {
        if (!dateStr) return null;
        return new Date(dateStr);
    }

    function getDiffMinutes(advertisedStr, actualStr) {
        const advertised = parseDate(advertisedStr);
        const actual = parseDate(actualStr);
        if (!advertised || !actual) return 0;
        return Math.round((actual - advertised) / 60000);
    }

    function formatDelay(diff) {
        if (diff <= 0) return '';
        return `+${diff}`;
    }

    function formatTime(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }

    function getBestDestination(ann) {
        if (ann.ToLocation && ann.ToLocation.length > 0) {
            return ann.ToLocation[ann.ToLocation.length - 1].LocationName;
        }
        return '';
    }

    function showError(message) {
        $('#loading').hide();
        $('#error-message').text(message).show();
    }

    function showLoading(show) {
        if (show) {
            $('#loading').show();
            $('#train-table').hide();
        } else {
            $('#loading').hide();
            $('#train-table').show();
        }
    }

    function updateLastUpdate() {
        const now = new Date().toLocaleTimeString('sv-SE');
        $('#last-update').text(`Uppdaterad: ${now}`);
    }

    // Bygg stationslänk
    function stationLink(signature, name) {
        const displayName = name || signature;
        const encodedSign = encodeURIComponent(signature);
        return `<a href="https://search.stationen.info/station.html?sign=${encodedSign}" class="station-link" target="_blank">${displayName}</a>`;
    }

    // Bygg tåglänk
    function trainLink(trainIdent, destination, delayInfo) {
        const delayClass = delayInfo.diff > 5 ? 'delayed' : (delayInfo.diff > 0 ? 'minor-delay' : 'on-time');
        const delayText = delayInfo.text ? ` <span class="${delayClass}">${delayInfo.text}</span>` : '';
        const destText = destination ? ` → ${destination}` : '';
        return `<a href="train.html?train=${encodeURIComponent(trainIdent)}" class="train-link">${trainIdent}${destText}${delayText}</a>`;
    }

    // Hitta tågets destination
    function findTrainDestination(announcements) {
        if (!announcements || announcements.length === 0) return '';
        const lastAnn = announcements[announcements.length - 1];
        return lastAnn.LocationSignature || getBestDestination(lastAnn);
    }

    // Hitta tågets ursprung
    function findTrainOrigin(announcements) {
        if (!announcements || announcements.length === 0) return '';
        const firstAnn = announcements[0];
        if (firstAnn.FromLocation && firstAnn.FromLocation.length > 0) {
            return firstAnn.FromLocation[0].LocationName;
        }
        return firstAnn.LocationSignature;
    }

    // Bygg rutt från announcements
    function buildRoute(announcements) {
        const stations = [];
        const seen = new Set();
        
        announcements.forEach(ann => {
            if (!seen.has(ann.LocationSignature)) {
                seen.add(ann.LocationSignature);
                stations.push({
                    signature: ann.LocationSignature,
                    announcements: []
                });
            }
            const station = stations.find(s => s.signature === ann.LocationSignature);
            station.announcements.push(ann);
        });
        
        return stations;
    }

    // Avgör om ett tåg går i samma riktning eller mötande
    function isTrainSameDirection(otherBearing) {
        if (myTrainBearing === null || otherBearing === null) {
            return null; // Okänt
        }
        // Om bearing-skillnaden är mindre än 90 grader = samma riktning
        let diff = Math.abs(myTrainBearing - otherBearing);
        if (diff > 180) diff = 360 - diff;
        return diff < 90;
    }

    // Huvudfunktion: Ladda tågdata
    async function loadTrainData() {
        scrollPos = $(window).scrollTop();
        
        try {
            // 1. Hämta tågets announcements (rutt)
            const annResponse = await TrafikverketAPI.getTrainAnnouncements(trainNumber);
            const announcements = annResponse.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];
            
            if (announcements.length === 0) {
                showError(`Tåg ${trainNumber} hittades inte`);
                return;
            }

            // 2. Hämta tågets exakta position
            const posResponse = await TrafikverketAPI.getTrainPosition(trainNumber);
            const positions = posResponse.RESPONSE?.RESULT?.[0]?.TrainPosition || [];
            
            if (positions.length > 0) {
                const pos = positions[0];
                myTrainPosition = pos.Position?.WGS84;
                myTrainBearing = pos.Bearing;
                myTrainSpeed = pos.Speed;
                
                // Visa hastighet
                if (myTrainSpeed !== null && myTrainSpeed !== undefined) {
                    $('#train-speed').text(`🚄 ${myTrainSpeed} km/h`);
                }
            }

            // 3. Bygg rutten
            const route = buildRoute(announcements);
            const locationSignatures = route.map(s => s.signature);
            const destination = findTrainDestination(announcements);
            const origin = findTrainOrigin(announcements);

            // Uppdatera header
            $('#train-label').text(`Tåg ${trainNumber} → ${destination}`);

            // 4. Hämta andra tåg på samma stationer
            const otherResponse = await TrafikverketAPI.getOtherTrains(locationSignatures, trainNumber);
            const otherAnnouncements = otherResponse.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];

            // 5. Hämta positioner för andra tåg (om vi har TrackPart)
            let otherPositions = [];
            if (positions.length > 0 && positions[0].TrackPart) {
                const trackPart = positions[0].TrackPart.split('.')[0]; // Hämta huvudbandelen
                const otherPosResponse = await TrafikverketAPI.getTrainPositionsOnTrack(trackPart);
                otherPositions = otherPosResponse.RESPONSE?.RESULT?.[0]?.TrainPosition || [];
            }

            // Skapa lookup för positioner
            const positionLookup = {};
            otherPositions.forEach(p => {
                positionLookup[p.TrainIdent] = p;
            });

            // Gruppera andra tåg per station
            const otherTrainsPerStation = {};
            otherAnnouncements.forEach(ann => {
                const sig = ann.LocationSignature;
                if (!otherTrainsPerStation[sig]) {
                    otherTrainsPerStation[sig] = { sameDir: [], opposite: [] };
                }
                
                const trainId = ann.AdvertisedTrainIdent;
                const pos = positionLookup[trainId];
                const sameDir = pos ? isTrainSameDirection(pos.Bearing) : null;
                
                const delayDiff = getDiffMinutes(ann.AdvertisedTimeAtLocation, ann.EstimatedTimeAtLocation || ann.TimeAtLocation);
                const delayInfo = { diff: delayDiff, text: formatDelay(delayDiff) };
                const dest = getBestDestination(ann);
                
                const trainData = {
                    trainId,
                    destination: dest,
                    delayInfo,
                    time: formatTime(ann.AdvertisedTimeAtLocation),
                    activity: ann.ActivityType
                };
                
                if (sameDir === true) {
                    otherTrainsPerStation[sig].sameDir.push(trainData);
                } else {
                    otherTrainsPerStation[sig].opposite.push(trainData);
                }
            });

            // 6. Hitta mitt tågs nuvarande position i rutten
            let currentStationIndex = -1;
            for (let i = route.length - 1; i >= 0; i--) {
                const station = route[i];
                const hasArrived = station.announcements.some(a => a.TimeAtLocation);
                if (hasArrived) {
                    currentStationIndex = i;
                    break;
                }
            }

            // 7. Bygg tabellen
            const $tbody = $('#table-body');
            $tbody.empty();

            route.forEach((station, index) => {
                const sig = station.signature;
                const others = otherTrainsPerStation[sig] || { sameDir: [], opposite: [] };
                
                // Skapa stationsrad
                const sameDirHtml = others.sameDir.map(t => trainLink(t.trainId, t.destination, t.delayInfo)).join('<br>') || '-';
                const oppositeHtml = others.opposite.map(t => trainLink(t.trainId, t.destination, t.delayInfo)).join('<br>') || '-';
                
                const $row = $(`
                    <tr>
                        <td>${stationLink(sig, sig)}</td>
                        <td>${sameDirHtml}</td>
                        <td>${oppositeHtml}</td>
                    </tr>
                `);
                
                $tbody.append($row);
                
                // Lägg till spacer-row efter nuvarande station
                if (index === currentStationIndex && index < route.length - 1) {
                    const speedText = myTrainSpeed ? ` • ${myTrainSpeed} km/h` : '';
                    const $spacer = $(`
                        <tr class="spacer-row">
                            <td colspan="3">
                                <span class="current-train-box">🚂 Tåg ${trainNumber}${speedText}</span>
                            </td>
                        </tr>
                    `);
                    $tbody.append($spacer);
                }
            });

            showLoading(false);
            updateLastUpdate();
            
            // Återställ scroll-position
            $(window).scrollTop(scrollPos);

        } catch (error) {
            console.error('Fel vid laddning:', error);
            showError('Kunde inte ladda tågdata');
        }
    }

    // Starta laddning
    loadTrainData();

    // Auto-uppdatering var 60:e sekund
    refreshInterval = setInterval(loadTrainData, 60000);

    // Manuell uppdatering
    $('#refresh-btn').on('click', function() {
        loadTrainData();
    });
});
