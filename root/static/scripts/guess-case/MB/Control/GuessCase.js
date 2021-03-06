// This file is part of MusicBrainz, the open internet music database.
// Copyright (C) 2015 MetaBrainz Foundation
// Licensed under the GPL version 2, or (at your option) any later version:
// http://www.gnu.org/licenses/gpl-2.0.txt

var i18n = require('../../../common/i18n.js');

MB.Control.initialize_guess_case = function (type, formPrefix) {
    formPrefix = formPrefix ? (formPrefix + "\\.") : "";

    var $name = $("#" + formPrefix + "name");
    var $options = $("#guesscase-options");

    if ($options.length && !$options.data("ui-dialog")) {
        $options.dialog({ title: i18n.l('Guess Case Options'), autoOpen: false });
        ko.applyBindingsToNode($options[0], { guessCase: _.noop });
    }

    var guess = MB.GuessCase[type];

    function setVal($input, value) {
        $input.val(value).trigger('change');
    }

    $name.parent()
        .find("button.guesscase-title").on("click", function () { setVal($name, guess.guess($name.val())) })
        .end()
        .find("button.guesscase-options").on("click", function () { $options.dialog("open") });

    var $sortname = $("#" + formPrefix + "sort_name");
    var $artistType = $('#id-edit-artist\\.type_id');

    $sortname.parent()
        .find("button.guesscase-sortname").on("click", function () {
            var args = [$name.val()];

            if (type === "artist") {
                args.push($artistType.val() != 2 /* person */);
            }

            setVal($sortname, guess.sortname.apply(guess, args));
        })
        .end()
        .find("button.sortname-copy").on("click", function () {
            setVal($sortname, $name.val());
        });
};

var guessCaseOptions = {
    modeName: ko.observable(),
    keepUpperCase: ko.observable(),
    upperCaseRoman: ko.observable()
};

var cookieSettings = { path: '/', expires: 365 };

var mode = ko.computed({
    read: function () {
        var modeName = guessCaseOptions.modeName()

        if (modeName !== gc.modeName) {
            gc.modeName = modeName;
            gc.mode = MB.GuessCase.Mode[modeName];
            $.cookie("guesscase_mode", modeName, cookieSettings);
        }
        return gc.mode;
    },
    deferEvaluation: true
});

guessCaseOptions.help = ko.computed({
    read: function () {
        return mode().getDescription();
    },
    deferEvaluation: true
});

guessCaseOptions.keepUpperCase.subscribe(function (value) {
    gc.CFG_UC_UPPERCASED = value;
    $.cookie("guesscase_keepuppercase", value, cookieSettings);
});

guessCaseOptions.upperCaseRoman.subscribe(function (value) {
    gc.CFG_UC_ROMANNUMERALS = value;
    $.cookie("guesscase_roman", value, cookieSettings);
});

ko.bindingHandlers.guessCase = {

    init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
        if (!guessCaseOptions.modeName.peek()) {
            guessCaseOptions.modeName(window.gc.modeName);
        }

        if (!guessCaseOptions.keepUpperCase.peek()) {
            guessCaseOptions.keepUpperCase(window.gc.CFG_UC_UPPERCASED);
        }

        if (!guessCaseOptions.upperCaseRoman.peek()) {
            guessCaseOptions.upperCaseRoman(window.gc.CFG_UC_ROMANNUMERALS);
        }

        var bindings = _.assign({}, guessCaseOptions);
        bindings.guessCase = _.bind(valueAccessor(), bindings);

        var context = bindingContext.createChildContext(bindings);
        ko.applyBindingsToDescendants(context, element);

        return { controlsDescendantBindings: true };
    }
};

ko.virtualElements.allowedBindings.guessCase = true;
