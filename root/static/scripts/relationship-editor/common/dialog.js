// This file is part of MusicBrainz, the open internet music database.
// Copyright (C) 2014 MetaBrainz Foundation
// Licensed under the GPL version 2, or (at your option) any later version:
// http://www.gnu.org/licenses/gpl-2.0.txt

(function (RE) {

    var UI = RE.UI = RE.UI || {};


    ko.bindingHandlers.relationshipEditorAutocomplete = (function() {

        var recentEntities = {};
        var dialog;

        function changeTarget(data) {
            if (!data || !data.gid) {
                return;
            }
            var type = data.entityType = data.entityType || dialog.targetType();

            // Add/move to the top of the recent entities menu.
            var recent = recentEntities[type] = recentEntities[type] || [],
                dup = _.where(recent, {gid: data.gid})[0];

            dup && recent.splice(recent.indexOf(dup), 1);
            recent.unshift(data);

            var relationship = dialog.relationship();
            var entities = relationship.entities().slice(0);

            entities[dialog.backward() ? 0 : 1] = MB.entity(data);
            relationship.entities(entities);
        }

        function showRecentEntities(event) {
            if (event.originalEvent === undefined || // event was triggered by code, not user
                (event.type == "keyup" && !_.contains([8, 40], event.keyCode)))
                return;

            var recent = recentEntities[dialog.targetType()],
                ac = dialog.autocomplete;

            if (!this.value && recent && recent.length && !ac.menu.active) {
                // setting ac.term to "" prevents the autocomplete plugin
                // from running its own search, which closes our menu.
                ac.term = "";
                ac._suggest(recent);
            }
        }

        return {
            init: function (element, valueAccessor, allBindings, viewModel, bindingContext) {
                dialog = valueAccessor();

                dialog.autocomplete = $(element).autocomplete({
                        entity: dialog.targetType(),
                        setEntity: dialog.targetType
                    })
                    .data("ui-autocomplete");

                dialog.autocomplete.currentSelection.subscribe(changeTarget);

                $(element).on("keyup focus click", showRecentEntities);

                var target = dialog.relationship().target(dialog.source);

                if (dialog instanceof UI.EditDialog) {
                    dialog.autocomplete.currentSelection(target);
                } else {
                    // Fills in the recording name in the add-related-work dialog.
                    dialog.autocomplete.currentSelection({ name: target.name });
                }
            }
        };
    }());


    ko.bindingHandlers.instrumentSelect = {

        init: function (element, valueAccessor, allBindings, viewModel, bindingContext) {
            var value = valueAccessor();

            var initialData = $.map(value(), function (id) {
                var attr = MB.attrInfoByID[id];

                if (attr.root_id == 14) {
                    return ko.observable(MB.entity(attr, "instrument"));
                }
            });

            var instruments = ko.observableArray(initialData);

            var vm = {
                instruments: instruments,

                addItem: function () {
                    instruments.push(ko.observable(MB.entity.Instrument({})));
                },

                removeItem: function (item) { instruments.remove(item) }
            };

            if (!initialData.length) vm.addItem();

            function getID(observable) {
                var gid = observable().gid

                return gid && MB.attrInfoByID[gid].id;
            }

            ko.computed({
                read: function () {
                    var nonInstruments = _.reject(value(), function (id) {
                        return MB.attrInfoByID[id].root_id == 14;
                    });

                    value(_(instruments()).map(getID).compact().union(nonInstruments).sort().value());
                },
                disposeWhenNodeIsRemoved: element
            });

            var childBindingContext = bindingContext.createChildContext(vm);
            ko.applyBindingsToDescendants(childBindingContext, element);

            return { controlsDescendantBindings: true };
        }
    };


    var Dialog = aclass({

        loading: ko.observable(false),
        showAttributesHelp: ko.observable(false),
        showLinkTypeHelp: ko.observable(false),

        uiOptions: {
            dialogClass: "rel-editor-dialog",
            draggable: false,
            resizable: false,
            autoOpen: false,
            width: "auto"
        },

        init: function (options) {
            var self = this;

            this.viewModel = options.viewModel;

            var source = options.source;
            var target = options.target;

            if (options.relationship) {
                target = options.relationship.target(source);
            } else {
                options.relationship = this.viewModel.getRelationship({
                    target: target, direction: options.direction
                }, source);

                options.relationship.linkTypeID(
                    defaultLinkType({ children: MB.typeInfo[options.relationship.entityTypes] })
                );
            }

            this.relationship = ko.observable(options.relationship);
            this.source = source;

            this.targetType = ko.observable(target.entityType);
            this.targetType.subscribe(this.targetTypeChanged, this);

            this.setupUI();
        },

        setupUI: _.once(function () {
            var $dialog = $("#dialog").dialog(this.uiOptions);

            var widget = $dialog.data("ui-dialog");
            widget.uiDialog.find(".ui-dialog-titlebar").remove();

            Dialog.extend({ $dialog: $dialog, widget: widget });
            ko.applyBindings(this.viewModel, $dialog[0]);
        }),

        open: function (positionBy) {
            this.viewModel.activeDialog(this);

            var widget = this.widget;

            this.positionBy(positionBy);

            if (!widget.isOpen()) {
                widget.open();
            }

            if (widget.uiDialog.width() > widget.options.maxWidth) {
                widget.uiDialog.width(widget.options.maxWidth);
            }

            // Call this.positionBy twice to prevent jumping in Opera
            this.positionBy(positionBy);

            this.$dialog.find(".link-type").focus();
        },

        accept: function (inner) {
            if (!this.hasErrors()) {
                inner && inner.apply(this, _.toArray(arguments).slice(1));
                this.close(false);
            }
        },

        close: function () {
            this.viewModel.activeDialog(null);
            this.widget && this.widget.close();
        },

        clickEvent: function (data, event) {
            if (!event.isDefaultPrevented()) {
                var $menu = this.$dialog.find(".menu");

                if ($menu.length) {
                    $menu.data("multiselect").menuVisible(false);
                }
            }

            return true;
        },

        keydownEvent: function (data, event) {
            if (event.isDefaultPrevented()) {
                return;
            }

            var nodeName = event.target.nodeName.toLowerCase();
            var self = this;

            // Firefox needs a small delay in order to allow for the change
            // event to trigger on <select> menus.

            _.defer(function() {
                if (event.keyCode === 13 && /^input|select$/.test(nodeName) && !self.hasErrors()) {
                    self.accept();
                } else if (event.keyCode === 27 && nodeName !== "select") {
                    self.close();
                }
            });

            return true;
        },

        toggleAttributesHelp: function() {
            this.showAttributesHelp(!this.showAttributesHelp());
        },

        changeDirection: function() {
            var relationship = this.relationship.peek();
            relationship.entities(relationship.entities().slice(0).reverse());
        },

        backward: function () {
            return this.source === this.relationship().entities()[1];
        },

        attributeFields: function () {
            var typeInfo = this.relationship().linkTypeInfo();
            return typeInfo ? _.values(typeInfo.attributes) : [];
        },

        afterRenderLinkTypeOption: function (option, data) {
            if (data.disabled) {
                option.disabled = true;
            }
        },

        toggleLinkTypeHelp: function() {
            this.showLinkTypeHelp(!this.showLinkTypeHelp.peek());
        },

        linkTypeDescription: function () {
            var typeInfo = this.relationship().linkTypeInfo();
            var description;

            if (typeInfo) {
                description = MB.i18n.expand(MB.text.MoreDocumentation, {
                    description: typeInfo.description,
                    url: { href: "/relationship/" + typeInfo.gid, target: "_blank" }
                });
            }

            return description || "";
        },

        positionBy: function (element) {
            this.widget._setOption("position", {
                my: "top center", at: "center", of: element
            });
        },

        targetTypeOptions: function () {
            var sourceType = this.source.entityType;
            var targetTypes = this.viewModel.allowedRelations[sourceType];

            return _.map(targetTypes, function (type) {
                return { value: type, text: MB.text.Entity[type] };
            });
        },

        targetTypeChanged: function (newType) {
            if (!newType) return;

            var currentRelationship = this.relationship();
            var currentTarget = currentRelationship.target(this.source);

            var data = currentRelationship.editData();
            data.target = MB.entity({ name: currentTarget.name }, newType);

            // Always keep any existing dates, even if the new relationship
            // doesn't support them. If they're not supported they'll be
            // hidden/ignored anyway, but if the user changes the target type
            // or link type again (to something that does support them), we
            // want to preserve what they previously entered.
            var period = currentRelationship.period;
            data.beginDate = MB.edit.fields.partialDate(period.beginDate);
            data.endDate = MB.edit.fields.partialDate(period.endDate);
            data.ended = !!period.ended();

            delete data.linkTypeID;
            delete data.entities;

            var newRelationship = this.viewModel.getRelationship(data, this.source);

            newRelationship.linkTypeID(
                defaultLinkType({ children: MB.typeInfo[newRelationship.entityTypes] })
            );

            this.relationship(newRelationship);
            currentRelationship.remove();

            var ac = this.autocomplete;

            if (ac) {
                ac.clear();
                ac.changeEntity(newType);
            }
        },

        linkTypeError: function () {
            var typeInfo = this.relationship().linkTypeInfo();

            if (!typeInfo) {
                return MB.text.PleaseSelectARType;
            } else if (!typeInfo.description) {
                return MB.text.PleaseSelectARSubtype;
            } else if (typeInfo.deprecated) {
                return MB.text.RelationshipTypeDeprecated;
            }

            return "";
        },

        targetEntityError: function () {
            var target = this.relationship().target(this.source);

            if (!target.gid) {
                return MB.text.RequiredField;
            } else if (this.source === target) {
                return MB.text.DistinctEntities;
            }

            return "";
        },

        attributeError: function (rootInfo) {
            var relationship = this.relationship();
            var attrInfo = relationship.linkTypeInfo().attributes;
            var min = rootInfo.min;

            if (min > 0) {
                var attributes = relationship.attributes();

                for (var i = 0, count = 0, id; id = attributes[i]; i++) {
                    if (MB.attrInfoByID[id].root === rootInfo.attribute) {
                        count++;
                    }
                }

                if (count < min) {
                    return MB.text.AttributeRequired;
                }
            }

            return "";
        },

        dateError: function (date) {
            var valid = MB.utility.validDate(date.year(), date.month(), date.day());
            return valid ? "" : MB.text.InvalidDate;
        },

        datePeriodError: function () {
            var period = this.relationship().period;

            var a = period.beginDate;
            var b = period.endDate;

            if (!this.dateError(a) && !this.dateError(b)) {
                var y1 = a.year(), m1 = a.month(), d1 = a.day();
                var y2 = b.year(), m2 = b.month(), d2 = b.day();

                if ((y1 && y2 && y2 < y1) ||
                    (y1 == y2 && (m2 < m1 || (m1 == m2 && d2 < d1)))) {
                    return MB.text.InvalidEndDate;
                }
            }

            return "";
        },

        hasErrors: function() {
            var relationship = this.relationship();

            return this.linkTypeError() ||
                   this.targetEntityError() ||
                   _(relationship.linkTypeInfo().attributes)
                     .values().map(_.bind(this.attributeError, this)).any() ||
                   this.dateError(relationship.period.beginDate) ||
                   this.dateError(relationship.period.endDate) ||
                   this.datePeriodError();
        }
    });


    UI.AddDialog = aclass(Dialog, {

        dialogTemplate: "template.relationship-dialog",
        disableTypeSelection: false,

        augment$accept: function () {
            if (!this.source.mergeRelationship(this.relationship())) {
                this.relationship().show();
            }
        },

        before$close: function (cancel) {
            if (cancel !== false) {
                this.relationship().remove();
            }
        }
    });


    UI.EditDialog = aclass(Dialog, {

        dialogTemplate: "template.relationship-dialog",
        disableTypeSelection: true,

        before$init: function (options) {
            // originalRelationship is a copy of the relationship when the dialog
            // was opened, i.e. before the user edits it. if they cancel the
            // dialog, this is what gets copied back to revert their changes.
            this.originalRelationship = options.relationship.editData();
        },

        before$close: function (cancel) {
            if (cancel !== false) {
                var relationship = this.relationship();

                if (!_.isEqual(this.originalRelationship, relationship.editData())) {
                    relationship.fromJS(this.originalRelationship);
                }
            }
        }
    });


    UI.BatchRelationshipDialog = aclass(Dialog, {

        dialogTemplate: "template.batch-relationship-dialog",
        disableTypeSelection: false,

        around$init: function (supr, options) {
            this.sources = options.sources;

            options.source = MB.entity({}, this.sources[0].entityType);
            options.target = options.target || MB.entity.Artist({});

            supr(options);
        },

        augment$accept: function (callback) {
            var vm = this.viewModel;
            var model = _.omit(this.relationship().editData(), "id", "entities");

            model.target = this.relationship().target(this.source);
            model.direction = this.backward() ? "backward" : "forward";

            _.each(this.sources, function (source) {
                model = _.clone(model);

                if (!callback || callback(model)) {
                    var newRelationship = vm.getRelationship(model, source);

                    if (!source.mergeRelationship(newRelationship)) {
                        newRelationship.show();
                    }
                }
            });
        }
    });


    UI.BatchCreateWorksDialog = aclass(UI.BatchRelationshipDialog, {

        dialogTemplate: "template.batch-create-works-dialog",
        workType: ko.observable(null),
        workLanguage: ko.observable(null),

        around$init: function (supr, options) {
            this.error = ko.observable(false);
            supr(_.assign(options, { target: MB.entity.Work({}) }));
        },

        around$accept: function (supr) {
            var self = this,
                workType = this.workType(),
                workLang = this.workLanguage();

            this.loading(true);

            var edits = _.map(this.sources, function (source) {
                var editData = MB.edit.fields.work({
                    name: source.name,
                    typeID: workType,
                    languageID: workLang
                });

                return MB.edit.workCreate(editData);
            });

            MB.edit.create({ editNote: "", asAutoEditor: true, edits: edits })
                .done(function (data) {
                    var works = _.pluck(data.edits, "entity");

                    supr(function (relationshipData) {
                        relationshipData.target = MB.entity(works.shift(), "work");
                        return true;
                    });

                    self.loading(false);
                })
                .fail(function () {
                    self.loading(false);
                    self.error(true);
                });
        },

        targetEntityError: function () { return "" }
    });


    function defaultLinkType(root) {
        var child, id, i = 0;

        while (child = root.children[i++]) {
            if (child.description && !child.deprecated) {
                return child.id;
            }
            if (child.children && (id = defaultLinkType(child))) {
                return id;
            }
        }
    };

}(MB.relationshipEditor = MB.relationshipEditor || {}));