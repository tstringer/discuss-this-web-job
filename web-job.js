/*
 * this is the web job that routinely does a few things
 * 1. recycles the question (sets the new question)
 * 2. tweets the question
 * 
 * the current duration is 7 minutes
 * 
 * currently there is no auth logic to restrict API calls 
 * to set the next question. this will be implemented soon
 */

var http = require('http');
var exec = require('child_process').exec;
var Twitter = require('twitter');
var DocumentClient = require('documentdb').DocumentClient;

var client = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

var config = {
    questionDisplayMinutes: 1,
    hostName: 'localhost',
    requestPort: 3000
};

var interval = config.questionDisplayMinutes * 60 * 1000;

function formatTweetText(tweetText) {
    var maxCharacterCount = 140;
    var cutOff = ' ...';
    
    if (tweetText.length > maxCharacterCount) {
        if (tweetText[maxCharacterCount - cutOff.length - 1] === ' ') {
            tweetText = tweetText.substring(0, maxCharacterCount - cutOff.length - 1) + cutOff;
        }
        else {
            tweetText = tweetText.substring(0, tweetText.substring(0, maxCharacterCount - cutOff.length - 1).lastIndexOf(' ')) + cutOff;
        }
    }
    
    return tweetText;
}
function tweetQuestion(question) {
    client.post('statuses/update', {status: formatTweetText(question.text)}, function (err, tweet, res) {
        if (err && process.env.NODE_ENV !== 'development') {
            throw err;
        }
    });
}

function getTopNextQuestionCandidate(callback) {
    http.get('http://' + config.hostName + ':' + config.requestPort + '/questions/next/1', function (response) {
        var dataTotal = '';
        response.on('data', function (data) {
            dataTotal += data;
        });
        response.on('end', function () {
            if (dataTotal === '') {
                callback(null);
            }
            else {
                var questions = JSON.parse(dataTotal);
                if (questions === undefined || questions === null || questions.length === 0) {
                    callback(null);
                }
                else {
                    callback(questions[0]);
                }
            }
        });
    });
}

function setNextQuestion() {
    getTopNextQuestionCandidate(function (question) {
        var req;
        if (question === undefined || question === null) {
            // there is no next question candidate so now
            // we need to set the current no question start date
            // to right now for clients to pull from
            //
            req = http.request(
                {
                    host: config.hostName,
                    path: '/questions/noquestion/' + process.env.JOBKEY,
                    port: config.requestPort,
                    method: 'POST'
                }
            );
            req.on('error', function (ex) {
                console.log('request error: ' + ex.message);
            });
            
            req.end();
        }
        else {
            tweetQuestion(question);
            req = http.request(
                {
                    host: config.hostName,
                    path: '/questions/gen/' + process.env.JOBKEY,
                    port: config.requestPort,
                    method: 'POST'
                }
            );
            req.on('error', function (ex) {
                console.log('request error: ' + ex.message);
            });
            
            req.end();
        }
    });
}

// set the dateAsked of the current question to the now time
//
// THIS IS FOR DEBUGGING AND TESTING ONLY
//

if (process.env.NODE_ENV === 'development') {
    console.log('development environment, setting current dateAsked...');
    if (process.env.DBMS_TYPE === 'documentdb') {
        console.log('using documentdb...');
        var docClient = new DocumentClient(process.env.DOCUMENTDB_HOST_URL, {masterKey: process.env.DOCUMENTDB_MASTER_KEY});
        var dbQuery = {
            query: 'SELECT * FROM d WHERE d.id = @id',
            parameters: [
                {
                    name: '@id',
                    value: process.env.DOCUMENTDB_DB_NAME
                }
            ]
        };
        docClient.queryDatabases(dbQuery)
            .current(function (err, database) {
                if (!err && database) {
                    var collQuery = {
                        query: 'SELECT * FROM c WHERE c.id = @id',
                        parameters: [
                            {
                                name: '@id',
                                value: process.env.DOCUMENTDB_QUESTION_COL_NAME
                            }
                        ]
                    };
                    docClient.queryCollections(database._self, collQuery)
                        .current(function (err, collection) {
                            if (!err && collection) {
                                var docQuery = 'SELECT * FROM q WHERE q.isCurrent = true';
                                docClient.queryDocuments(collection._self, docQuery)
                                    .current(function (err, element) {
                                        if (!err && element) {
                                            var currentDate = new Date();
                                            console.log('setting current datetime for current question: ' + currentDate);
                                            element.dateAsked = currentDate;
                                            docClient.replaceDocument(element._self, element, function (err, res) {
                                                if (!err && res) {
                                                    console.log('successfully set current dateAsked to ' + res.dateAsked);
                                                }
                                            });
                                        }
                                    });
                            }
                        });
                }
            });
    }
    else {
        exec('mongo .\\data\\mongo-set-current-question-dateAsked.js', function (err, stdout, stderr) {
            console.log(stdout);
            console.log(stderr);
            
            console.log('current date: ' + (new Date()).toLocaleString());
        });
    }
}

setInterval(setNextQuestion, interval); 