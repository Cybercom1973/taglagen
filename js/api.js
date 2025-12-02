const TrafikverketAPI = {
    apiKey: '4759059607504e98ba567480d71df54e',
    apiUrl: 'https://api.trafikinfo.trafikverket.se/v2/data.json',

    escapeXml: function(str) {
        if (!str) return '';
        return str.replace(/[<>&'"/g, function(c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
        });
    },

    request: function(query) {
        const xmlRequest = `
            <REQUEST>
                <LOGIN authenticationkey="${this.apiKey}" />
                ${query}
            </REQUEST>
        `;
        return $.ajax({
            url: this.apiUrl,
            method: 'POST',
            contentType: 'text/xml',
            data: xmlRequest,
            dataType: 'json'
        });
    },

    getTrainAnnouncements: function(trainNumber) {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <EQ name="AdvertisedTrainIdent" value="${this.escapeXml(trainNumber)}" />
                        <GTE name="AdvertisedTimeAtLocation" value="${today}T00:00:00" />
                        <LTE name="AdvertisedTimeAtLocation" value="${today}T23:59:59" />
                    </AND>
                </FILTER>
                <INCLUDE>ActivityType</INCLUDE>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>FromLocation</INCLUDE>
                <INCLUDE>TrackAtLocation</INCLUDE>
                <INCLUDE>Canceled</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    },

    getTrainPosition: function(trainIdent) {
        const query = `
            <QUERY objecttype="TrainPosition" schemaversion="1.1" limit="1">
                <FILTER>
                    <EQ name="TrainIdent" value="${this.escapeXml(trainIdent)}" />
                </FILTER>
                <INCLUDE>TrainIdent</INCLUDE>
                <INCLUDE>Position.WGS84</INCLUDE>
                <INCLUDE>Speed</INCLUDE>
                <INCLUDE>Bearing</INCLUDE>
                <INCLUDE>TrackPart</INCLUDE>
                <INCLUDE>TimeStamp</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    },

    getTrainPositionsOnTrack: function(trackPart) {
        const query = `
            <QUERY objecttype="TrainPosition" schemaversion="1.1">
                <FILTER>
                    <LIKE name="TrackPart" value="${this.escapeXml(trackPart)}%" />
                </FILTER>
                <INCLUDE>TrainIdent</INCLUDE>
                <INCLUDE>Position.WGS84</INCLUDE>
                <INCLUDE>Speed</INCLUDE>
                <INCLUDE>Bearing</INCLUDE>
                <INCLUDE>TrackPart</INCLUDE>
                <INCLUDE>TimeStamp</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    },

    getOtherTrains: function(locationSignatures, excludeTrainIdent) {
        if (!locationSignatures || locationSignatures.length === 0) {
            return $.Deferred().resolve({ RESPONSE: { RESULT: [{ TrainAnnouncement: [] }] } });
        }
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
        const locationFilters = locationSignatures.map(sig => 
            `<EQ name="LocationSignature" value="${this.escapeXml(sig)}" />`
        ).join('');
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <OR>${locationFilters}</OR>
                        <GTE name="AdvertisedTimeAtLocation" value="${oneHourAgo}" />
                        <LTE name="AdvertisedTimeAtLocation" value="${twoHoursLater}" />
                        <NE name="AdvertisedTrainIdent" value="${this.escapeXml(excludeTrainIdent)}" />
                    </AND>
                </FILTER>
                <INCLUDE>ActivityType</INCLUDE>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>FromLocation</INCLUDE>
                <INCLUDE>Canceled</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    },

    getAllTrainStations: function() {
        const query = `
            <QUERY objecttype="TrainStation" schemaversion="1.5">
                <FILTER>
                    <EQ name="Prognosticated" value="true" />
                </FILTER>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>AdvertisedLocationName</INCLUDE>
                <INCLUDE>Geometry.WGS84</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    }
};
