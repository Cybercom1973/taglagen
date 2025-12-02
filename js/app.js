$(document).ready(function() {
    const $input = $('#train-input');
    const $searchBtn = $('#search-btn');
    const $error = $('#error-message');

    function searchTrain() {
        const trainNumber = $input.val().trim();
        
        if (!trainNumber) {
            showError('Ange ett tågnummer');
            return;
        }
        
        // Navigera till tågvyn
        window.location.href = `train.html?train=${encodeURIComponent(trainNumber)}`;
    }

    function showError(message) {
        $error.text(message).show();
        setTimeout(() => $error.fadeOut(), 3000);
    }

    // Event listeners
    $searchBtn.on('click', searchTrain);
    
    $input.on('keypress', function(e) {
        if (e.which === 13) {
            searchTrain();
        }
    });

    // Rensa fel när man skriver
    $input.on('input', function() {
        $error.hide();
    });
});
