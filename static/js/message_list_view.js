var render_bookend = require('../templates/bookend.hbs');
var render_message_group = require('../templates/message_group.hbs');
var render_recipient_row = require('../templates/recipient_row.hbs');
var render_single_message = require('../templates/single_message.hbs');

function MessageListView(list, table_name, collapse_messages) {
    this.list = list;
    this.collapse_messages = collapse_messages;
    this._rows = {};
    this.message_containers = {};
    this.table_name = table_name;
    if (this.table_name) {
        this.clear_table();
    }
    this._message_groups = [];

    // Half-open interval of the indices that define the current render window
    this._render_win_start = 0;
    this._render_win_end = 0;
}

(function () {

function get_user_id_for_mention_button(elem) {
    var user_id = $(elem).attr('data-user-id');
    // Handle legacy markdown that was rendered before we cut
    // over to using data-user-id.
    var email = $(elem).attr('data-user-email');

    if (user_id === "*" || email === "*") {
        return "*";
    }

    if (user_id) {
        return user_id;
    }

    if (email) {
        // Will return undefined if there's no match
        var user = people.get_by_email(email);
        if (user) {
            return user.user_id;
        }
        return;
    }
    return;
}

function get_user_group_id_for_mention_button(elem) {
    var user_group_id = $(elem).attr('data-user-group-id');

    if (user_group_id) {
        return user_group_id;
    }

    return;
}

function same_day(earlier_msg, later_msg) {
    if (earlier_msg === undefined || later_msg === undefined) {
        return false;
    }
    var earlier_time = new XDate(earlier_msg.msg.timestamp * 1000);
    var later_time = new XDate(later_msg.msg.timestamp * 1000);

    return earlier_time.toDateString() === later_time.toDateString();
}

function same_sender(a, b) {
    if (a === undefined || b === undefined) {
        return false;
    }
    return util.same_sender(a.msg, b.msg);
}

function same_recipient(a, b) {
    if (a === undefined || b === undefined) {
        return false;
    }
    return util.same_recipient(a.msg, b.msg);
}

function render_group_display_date(group, message_container) {
    var time = new XDate(message_container.msg.timestamp * 1000);
    var today = new XDate();
    var date_element = timerender.render_date(time, undefined, today)[0];

    group.date = date_element.outerHTML;
}

function update_group_date_divider(group, message_container, prev) {
    var time = new XDate(message_container.msg.timestamp * 1000);
    var today = new XDate();

    if (prev !== undefined) {
        var prev_time = new XDate(prev.msg.timestamp * 1000);
        if (time.toDateString() !== prev_time.toDateString()) {
            // NB: group_date_divider_html is HTML, inserted into the document without escaping.
            group.group_date_divider_html = timerender.render_date(time, prev_time,
                                                                   today)[0].outerHTML;
            group.show_group_date_divider = true;
        }
    } else {
        // Show the date in the recipient bar, but not a date separator bar.
        group.show_group_date_divider = false;
        group.group_date_divider_html = timerender.render_date(time, undefined, today)[0].outerHTML;
    }
}

function clear_group_date_divider(group) {
    group.show_group_date_divider = false;
    group.group_date_divider_html = undefined;
}

function clear_message_date_divider(msg) {
    // see update_message_date_divider for how
    // these get set
    msg.want_date_divider = false;
    msg.date_divider_html = undefined;
}

function update_message_date_divider(opts) {
    var prev_msg_container = opts.prev_msg_container;
    var curr_msg_container = opts.curr_msg_container;

    if (!prev_msg_container || same_day(curr_msg_container, prev_msg_container)) {
        clear_message_date_divider(curr_msg_container);
        return;
    }

    var prev_time = new XDate(prev_msg_container.msg.timestamp * 1000);
    var curr_time = new XDate(curr_msg_container.msg.timestamp * 1000);
    var today = new XDate();

    curr_msg_container.want_date_divider = true;
    curr_msg_container.date_divider_html =
        timerender.render_date(curr_time, prev_time, today)[0].outerHTML;
}

function set_timestr(message_container) {
    var time = new XDate(message_container.msg.timestamp * 1000);
    message_container.timestr = timerender.stringify_time(time);
}

function set_topic_edit_properties(group, message) {
    group.realm_allow_message_editing = page_params.realm_allow_message_editing;
    group.always_visible_topic_edit = false;
    group.on_hover_topic_edit = false;

    // Messages with no topics should always have an edit icon visible
    // to encourage updating them. Admins can also edit any topic.
    if (util.get_message_topic(message) === compose.empty_topic_placeholder()) {
        group.always_visible_topic_edit = true;
    } else if (message_edit.is_topic_editable(message)) {
        group.on_hover_topic_edit = true;
    }
}

function populate_group_from_message_container(group, message_container) {
    group.is_stream = message_container.msg.is_stream;
    group.is_private = message_container.msg.is_private;

    if (group.is_stream) {
        group.background_color = stream_data.get_color(message_container.msg.stream);
        group.color_class = stream_color.get_color_class(group.background_color);
        group.invite_only = stream_data.get_invite_only(message_container.msg.stream);
        group.topic = util.get_message_topic(message_container.msg);
        group.match_topic = util.get_match_topic(message_container.msg);
        group.stream_url = message_container.stream_url;
        group.topic_url = message_container.topic_url;
        var sub = stream_data.get_sub(message_container.msg.stream);
        if (sub === undefined) {
            // Hack to handle unusual cases like the tutorial where
            // the streams used don't actually exist in the subs
            // module.  Ideally, we'd clean this up by making the
            // tutorial populate subs.js "properly".
            group.stream_id = -1;
        } else {
            group.stream_id = sub.stream_id;
        }
    } else if (group.is_private) {
        group.pm_with_url = message_container.pm_with_url;
        group.display_reply_to = message_store.get_pm_full_names(message_container.msg);
    }
    group.display_recipient = message_container.msg.display_recipient;
    group.topic_links = util.get_topic_links(message_container.msg);

    set_topic_edit_properties(group, message_container.msg);
    render_group_display_date(group, message_container);
}

MessageListView.prototype = {
    // Number of messages to render at a time
    _RENDER_WINDOW_SIZE: 400,
    // Number of messages away from edge of render window at which we
    // trigger a re-render
    _RENDER_THRESHOLD: 50,

    _get_msg_timestring: function (message_container) {
        if (message_container.msg.last_edit_timestamp !== undefined) {
            var last_edit_time = new XDate(message_container.msg.last_edit_timestamp * 1000);
            var today = new XDate();
            return timerender.render_date(last_edit_time, undefined, today)[0].textContent +
                " at " + timerender.stringify_time(last_edit_time);
        }
    },

    _add_msg_edited_vars: function (message_container) {
        // This adds variables to message_container object which calculate bools for
        // checking position of "(EDITED)" label as well as the edited timestring
        // The bools can be defined only when the message is edited
        // (or when the `last_edit_timestr` is defined). The bools are:
        //   * `edited_in_left_col`      -- when label appears in left column.
        //   * `edited_alongside_sender` -- when label appears alongside sender info.
        //   * `edited_status_msg`       -- when label appears for a "/me" message.
        var last_edit_timestr = this._get_msg_timestring(message_container);
        var include_sender = message_container.include_sender;
        var status_message = Boolean(message_container.status_message);
        if (last_edit_timestr !== undefined) {
            message_container.last_edit_timestr = last_edit_timestr;
            message_container.edited_in_left_col = !include_sender;
            message_container.edited_alongside_sender = include_sender && !status_message;
            message_container.edited_status_msg = include_sender && status_message;
        }
    },

    add_subscription_marker: function (group, last_msg_container, first_msg_container) {
        if (last_msg_container === undefined) {
            return;
        }

        var last_subscribed = !last_msg_container.msg.historical;
        var first_subscribed = !first_msg_container.msg.historical;
        var stream = first_msg_container.msg.stream;

        if (!last_subscribed && first_subscribed) {
            group.bookend_top = true;
            group.subscribed = stream;
            group.bookend_content = this.list.subscribed_bookend_content(stream);
            return;
        }

        if (last_subscribed && !first_subscribed) {
            group.bookend_top = true;
            group.unsubscribed = stream;
            group.bookend_content = this.list.unsubscribed_bookend_content(stream);
            return;
        }
    },

    build_message_groups: function (message_containers) {
        function start_group() {
            return {
                message_containers: [],
                message_group_id: _.uniqueId('message_group_'),
            };
        }

        var self = this;
        var current_group = start_group();
        var new_message_groups = [];
        var prev;

        function add_message_container_to_group(message_container) {
            if (same_sender(prev, message_container)) {
                prev.next_is_same_sender = true;
            }
            current_group.message_containers.push(message_container);
        }

        function finish_group() {
            if (current_group.message_containers.length > 0) {
                populate_group_from_message_container(current_group,
                                                      current_group.message_containers[0]);
                current_group
                    .message_containers[current_group.message_containers.length - 1]
                    .include_footer = true;
                new_message_groups.push(current_group);
            }
        }

        _.each(message_containers, function (message_container) {
            var message_reactions = reactions.get_message_reactions(message_container.msg);
            message_container.msg.message_reactions = message_reactions;
            message_container.include_recipient = false;
            message_container.include_footer    = false;

            if (same_recipient(prev, message_container) && self.collapse_messages &&
                prev.msg.historical === message_container.msg.historical) {
                add_message_container_to_group(message_container);
                update_message_date_divider({
                    prev_msg_container: prev,
                    curr_msg_container: message_container,
                });
            } else {
                finish_group();
                current_group = start_group();
                add_message_container_to_group(message_container);

                update_group_date_divider(current_group, message_container, prev);
                clear_message_date_divider(message_container);

                message_container.include_recipient = true;
                message_container.subscribed = false;
                message_container.unsubscribed = false;

                // This home_msg_list condition can be removed
                // once we filter historical messages from the
                // home view on the server side (which requires
                // having an index on UserMessage.flags)
                if (self.list !== home_msg_list) {
                    self.add_subscription_marker(current_group, prev, message_container);
                }

                if (message_container.msg.stream) {
                    message_container.stream_url =
                        hash_util.by_stream_uri(message_container.msg.stream_id);
                    message_container.topic_url =
                        hash_util.by_stream_topic_uri(
                            message_container.msg.stream_id,
                            util.get_message_topic(message_container.msg));
                } else {
                    message_container.pm_with_url =
                        message_container.msg.pm_with_url;
                }
            }

            set_timestr(message_container);

            message_container.include_sender = true;
            if (!message_container.include_recipient &&
                !prev.status_message &&
                same_day(prev, message_container) &&
                same_sender(prev, message_container)) {
                message_container.include_sender = false;
            }

            message_container.sender_is_bot = people.sender_is_bot(message_container.msg);
            message_container.sender_is_guest = people.sender_is_guest(message_container.msg);

            message_container.small_avatar_url = people.small_avatar_url(message_container.msg);
            if (message_container.msg.stream) {
                message_container.background_color =
                    stream_data.get_color(message_container.msg.stream);
            }

            message_container.contains_mention = message_container.msg.mentioned;
            self._maybe_format_me_message(message_container);
            // Once all other variables are updated
            self._add_msg_edited_vars(message_container);

            prev = message_container;
        });

        finish_group();

        return new_message_groups;
    },

    join_message_groups: function (first_group, second_group) {
        // join_message_groups will combine groups if they have the
        // same_recipient and the view supports collapsing, otherwise
        // it may add a subscription_marker if required.  It returns
        // true if the two groups were joined in to one and the
        // second_group should be ignored.
        if (first_group === undefined || second_group === undefined) {
            return false;
        }
        var last_msg_container = _.last(first_group.message_containers);
        var first_msg_container = _.first(second_group.message_containers);

        // Join two groups into one.
        if (this.collapse_messages && same_recipient(last_msg_container, first_msg_container) &&
            last_msg_container.msg.historical === first_msg_container.msg.historical) {
            if (!last_msg_container.status_message && !first_msg_container.msg.is_me_message
                && same_day(last_msg_container, first_msg_container)
                && same_sender(last_msg_container, first_msg_container)) {
                first_msg_container.include_sender = false;
            }
            if (same_sender(last_msg_container, first_msg_container)) {
                last_msg_container.next_is_same_sender = true;
            }
            first_group.message_containers =
                first_group.message_containers.concat(second_group.message_containers);
            return true;
        // Add a subscription marker
        } else if (this.list !== home_msg_list &&
                   last_msg_container.msg.historical !== first_msg_container.msg.historical) {
            second_group.bookend_top = true;
            this.add_subscription_marker(second_group, last_msg_container, first_msg_container);
        }
        return false;
    },

    merge_message_groups: function (new_message_groups, where) {
        // merge_message_groups takes a list of new messages groups to add to
        // this._message_groups and a location where to merge them currently
        // top or bottom. It returns an object of changes which needed to be
        // rendered in to the page. The types of actions are append_group,
        // prepend_group, rerender_group, append_message.
        //
        // append_groups are groups to add to the top of the rendered DOM
        // prepend_groups are group to add to the bottom of the rendered DOM
        // rerender_groups are group that should be updated in place in the DOM
        // append_messages are messages which should be added to the last group in the DOM
        // rerender_messages are messages which should be updated in place in the DOM

        var message_actions = {
            append_groups: [],
            prepend_groups: [],
            rerender_groups: [],
            append_messages: [],
            rerender_messages_next_same_sender: [],
        };
        var first_group;
        var second_group;
        var curr_msg_container;
        var prev_msg_container;

        if (where === 'top') {
            first_group = _.last(new_message_groups);
            second_group = _.first(this._message_groups);
        } else {
            first_group = _.last(this._message_groups);
            second_group = _.first(new_message_groups);
        }

        if (first_group) {
            prev_msg_container = _.last(first_group.message_containers);
        }

        if (second_group) {
            curr_msg_container = _.first(second_group.message_containers);
        }

        var was_joined = this.join_message_groups(first_group, second_group);
        if (was_joined) {
            update_message_date_divider({
                prev_msg_container: prev_msg_container,
                curr_msg_container: curr_msg_container,
            });
        } else {
            clear_message_date_divider(curr_msg_container);
        }

        if (where === 'top') {
            if (was_joined) {
                // join_message_groups moved the old message to the end of the
                // new group. We need to replace the old rendered message
                // group. So we will reuse its ID.

                first_group.message_group_id = second_group.message_group_id;
                message_actions.rerender_groups.push(first_group);

                // Swap the new group in
                this._message_groups.shift();
                this._message_groups.unshift(first_group);

                new_message_groups = _.initial(new_message_groups);
            } else if (!same_day(second_group.message_containers[0],
                                 first_group.message_containers[0])) {
                // The groups did not merge, so we need up update the date row for the old group
                update_group_date_divider(second_group, curr_msg_container, prev_msg_container);
                // We could add an action to update the date row, but for now rerender the group.
                message_actions.rerender_groups.push(second_group);
            }
            message_actions.prepend_groups = new_message_groups;
            this._message_groups = new_message_groups.concat(this._message_groups);
        } else {
            if (was_joined) {
                // rerender the last message
                message_actions.rerender_messages_next_same_sender.push(prev_msg_container);
                message_actions.append_messages = _.first(new_message_groups).message_containers;
                new_message_groups = _.rest(new_message_groups);
            } else if (first_group !== undefined && second_group !== undefined) {
                if (same_day(prev_msg_container, curr_msg_container)) {
                    clear_group_date_divider(second_group);
                } else {
                    // If we just sent the first message on a new day
                    // in a narrow, make sure we render a date separator.
                    update_group_date_divider(second_group, curr_msg_container, prev_msg_container);
                }
            }
            message_actions.append_groups = new_message_groups;
            this._message_groups = this._message_groups.concat(new_message_groups);
        }

        return message_actions;
    },

    _put_row: function (row) {
        // row is a jQuery object wrapping one message row
        if (row.hasClass('message_row')) {
            this._rows[row.attr('zid')] = row;
        }
    },

    _post_process: function ($message_rows) {
        // $message_rows wraps one or more message rows

        if ($message_rows.constructor !== jQuery) {
            // An assertion check that we're calling this properly
            blueslip.error('programming error--pass in jQuery objects');
        }

        var self = this;
        _.each($message_rows, function (dom_row) {
            var row = $(dom_row);
            self._put_row(row);
            self._post_process_single_row(row);
        });
    },

    _post_process_single_row: function (row) {
        // For message formatting that requires some post-processing
        // (and is not possible to handle solely via CSS), this is
        // where we modify the content.  It is a goal to minimize how
        // much logic is present in this function; wherever possible,
        // we should implement features with the markdown processor,
        // HTML and CSS.

        if (row.length !== 1) {
            blueslip.error('programming error--expected single element');
        }

        var content = row.find('.message_content');

        // Set the rtl class if the text has an rtl direction
        if (rtl.get_direction(content.text()) === 'rtl') {
            content.addClass('rtl');
        }

        content.find('.user-mention').each(function () {
            var user_id = get_user_id_for_mention_button(this);
            // We give special highlights to the mention buttons
            // that refer to the current user.
            if (user_id === "*" || people.is_my_user_id(user_id)) {
                // Either a wildcard mention or us, so mark it.
                $(this).addClass('user-mention-me');
            }
            if (user_id && user_id !== "*" && !$(this).find(".highlight").length) {
                // If it's a mention of a specific user, edit the
                // mention text to show the user's current name,
                // assuming that you're not searching for text
                // inside the highlight.
                var person = people.get_person_from_user_id(user_id);
                if (person !== undefined) {
                    // Note that person might be undefined in some
                    // unpleasant corner cases involving data import.
                    markdown.set_name_in_mention_element(this, person.full_name);
                }
            }
        });

        content.find('.user-group-mention').each(function () {
            var user_group_id = get_user_group_id_for_mention_button(this);
            var user_group = user_groups.get_user_group_from_id(user_group_id, true);
            if (user_group === undefined) {
                // This is a user group the current user doesn't have
                // data on.  This can happen when user groups are
                // deleted.
                blueslip.info("Rendered unexpected user group " + user_group_id);
                return;
            }

            var my_user_id = people.my_current_user_id();
            // Mark user group you're a member of.
            if (user_groups.is_member_of(user_group_id, my_user_id)) {
                $(this).addClass('user-mention-me');
            }

            if (user_group_id && !$(this).find(".highlight").length) {
                // Edit the mention to show the current name for the
                // user group, if its not in search.
                $(this).text("@" + user_group.name);
            }
        });

        content.find('a.stream').each(function () {
            var stream_id = $(this).attr('data-stream-id');
            if (stream_id && !$(this).find(".highlight").length) {
                // Display the current name for stream if it is not
                // being displayed in search highlight.
                $(this).text("#" + stream_data.maybe_get_stream_name(stream_id));
            }
        });

        content.find('a.stream-topic').each(function () {
            var stream_id = $(this).attr('data-stream-id');
            if (stream_id && !$(this).find(".highlight").length) {
                // Display the current name for stream if it is not
                // being displayed in search highlight.
                var text = $(this).text();
                var topic = text.split('>', 2)[1];
                $(this).text("#" + stream_data.maybe_get_stream_name(stream_id) + ' > ' + topic);
            }
        });

        // Display emoji (including realm emoji) as text if
        // page_params.emojiset is 'text'.
        if (page_params.emojiset === 'text') {
            content.find(".emoji").replaceWith(function () {
                var text = $(this).attr("title");
                return ":" + text + ":";
            });
        }

        var id = rows.id(row);
        message_edit.maybe_show_edit(row, id);

        submessage.process_submessages({
            row: row,
            message_id: id,
        });
    },

    _get_message_template: function (message_container) {
        var msg_reactions = reactions.get_message_reactions(message_container.msg);
        message_container.msg.message_reactions = msg_reactions;
        var msg_to_render = _.extend(message_container, {
            table_name: this.table_name,
        });
        return render_single_message(msg_to_render);
    },

    _render_group: function (opts) {
        var message_groups = opts.message_groups;
        var use_match_properties = opts.use_match_properties;
        var table_name = opts.table_name;

        return $(render_message_group({
            message_groups: message_groups,
            use_match_properties: use_match_properties,
            table_name: table_name,
        }));
    },

    render: function (messages, where, messages_are_new) {
        // This function processes messages into chunks with separators between them,
        // and templates them to be inserted as table rows into the DOM.

        // Store this in a separate variable so it doesn't get
        // confusingly masked in upcoming loops.
        var self = this;

        if (messages.length === 0 || self.table_name === undefined) {
            return;
        }

        var list = self.list; // for convenience
        var table_name = self.table_name;
        var table = rows.get_table(table_name);
        var orig_scrolltop_offset;
        var message_containers;

        // If we start with the message feed scrolled up (i.e.
        // the bottom message is not visible), then we will respect
        // the user's current position after rendering, rather
        // than auto-scrolling.
        var started_scrolled_up = message_viewport.is_scrolled_up();

        // The messages we are being asked to render are shared with between
        // all messages lists. To prevent having both list views overwriting
        // each others data we will make a new message object to add data to
        // for rendering.
        message_containers = _.map(messages, function (message) {
            if (message.starred) {
                message.starred_status = i18n.t("Unstar");
            } else {
                message.starred_status = i18n.t("Star");
            }

            return {msg: message};
        });

        function save_scroll_position() {
            if (orig_scrolltop_offset === undefined && self.selected_row().length > 0) {
                orig_scrolltop_offset = self.selected_row().offset().top;
            }
        }

        function restore_scroll_position() {
            if (list === current_msg_list && orig_scrolltop_offset !== undefined) {
                list.view.set_message_offset(orig_scrolltop_offset);
                list.reselect_selected_id();
            }
        }

        // This function processes messages into chunks with separators between them,
        // and templates them to be inserted as table rows into the DOM.

        if (message_containers.length === 0 || self.table_name === undefined) {
            return;
        }

        var new_message_groups = self.build_message_groups(message_containers, self.table_name);
        var message_actions = self.merge_message_groups(new_message_groups, where);
        var new_dom_elements = [];
        var rendered_groups;
        var dom_messages;
        var last_message_row;
        var last_group_row;

        _.each(message_containers, function (message_container) {
            self.message_containers[message_container.msg.id] = message_container;
        });

        // Render new message groups on the top
        if (message_actions.prepend_groups.length > 0) {
            save_scroll_position();

            rendered_groups = self._render_group({
                message_groups: message_actions.prepend_groups,
                use_match_properties: self.list.is_search(),
                table_name: self.table_name,
            });

            dom_messages = rendered_groups.find('.message_row');
            new_dom_elements = new_dom_elements.concat(rendered_groups);

            self._post_process(dom_messages);

            // The date row will be included in the message groups or will be
            // added in a rerenderd in the group below
            table.find('.recipient_row').first().prev('.date_row').remove();
            table.prepend(rendered_groups);
            condense.condense_and_collapse(dom_messages);
        }

        // Rerender message groups
        if (message_actions.rerender_groups.length > 0) {
            save_scroll_position();

            _.each(message_actions.rerender_groups, function (message_group) {
                var old_message_group = $('#' + message_group.message_group_id);
                // Remove the top date_row, we'll re-add it after rendering
                old_message_group.prev('.date_row').remove();

                rendered_groups = self._render_group({
                    message_groups: [message_group],
                    use_match_properties: self.list.is_search(),
                    table_name: self.table_name,
                });

                dom_messages = rendered_groups.find('.message_row');
                // Not adding to new_dom_elements it is only used for autoscroll

                self._post_process(dom_messages);
                old_message_group.replaceWith(rendered_groups);
                condense.condense_and_collapse(dom_messages);
            });
        }

        // Update the rendering for message rows which used to be last
        // and now know whether the following message has the same
        // sender.
        //
        // It is likely the case that we can just remove the block
        // entirely, since it appears the next_is_same_sender CSS
        // class doesn't do anything.
        if (message_actions.rerender_messages_next_same_sender.length > 0) {
            var targets = message_actions.rerender_messages_next_same_sender;
            _.each(targets, function (message_container) {
                var row = self.get_row(message_container.msg.id);
                $(row).find("div.messagebox").toggleClass("next_is_same_sender",
                                                          message_container.next_is_same_sender);
            });
        }

        // Insert new messages in to the last message group
        if (message_actions.append_messages.length > 0) {
            last_message_row = table.find('.message_row').last().expectOne();
            last_group_row = rows.get_message_recipient_row(last_message_row);
            dom_messages = $(_.map(message_actions.append_messages, function (message_container) {
                return self._get_message_template(message_container);
            }).join('')).filter('.message_row');

            self._post_process(dom_messages);
            last_group_row.append(dom_messages);

            condense.condense_and_collapse(dom_messages);
            new_dom_elements = new_dom_elements.concat(dom_messages);
        }

        // Add new message groups to the end
        if (message_actions.append_groups.length > 0) {
            // Remove the trailing bookend; it'll be re-added after we do our rendering
            self.clear_trailing_bookend();

            rendered_groups = self._render_group({
                message_groups: message_actions.append_groups,
                use_match_properties: self.list.is_search(),
                table_name: self.table_name,
            });

            dom_messages = rendered_groups.find('.message_row');
            new_dom_elements = new_dom_elements.concat(rendered_groups);

            self._post_process(dom_messages);

            // This next line is a workaround for a weird scrolling
            // bug on Chrome.  Basically, in Chrome 64, we had a
            // highly reproducible bug where if you hit the "End" key
            // 5 times in a row in a `near:1` narrow (or any other
            // narrow with enough content below to try this), the 5th
            // time (because RENDER_WINDOW_SIZE / batch_size = 4,
            // i.e. the first time we need to rerender to show the
            // message "End" jumps to) would trigger an unexpected
            // scroll, resulting in some chaotic scrolling and
            // additional fetches (from bottom_whitespace ending up in
            // the view).  During debugging, we found that this adding
            // this next line seems to prevent the Chrome bug from firing.
            message_viewport.scrollTop();

            table.append(rendered_groups);
            condense.condense_and_collapse(dom_messages);
        }

        restore_scroll_position();

        var last_message_group = _.last(self._message_groups);
        if (last_message_group !== undefined) {
            list.last_message_historical =
                _.last(last_message_group.message_containers).msg.historical;
        }

        var stream_name = narrow_state.stream();
        if (stream_name !== undefined) {
            // If user narrows to a stream, doesn't update
            // trailing bookend if user is subscribed.
            var sub = stream_data.get_sub(stream_name);
            if (sub === undefined || !sub.subscribed) {
                list.update_trailing_bookend();
            }
        }

        if (list === current_msg_list) {
            // Update the fade.

            var get_element = function (message_group) {
                // We don't have a MessageGroup class, but we can at least hide the messy details
                // of rows.js from compose_fade.  We provide a callback function to be lazy--
                // compose_fade may not actually need the elements depending on its internal
                // state.
                var message_row = self.get_row(message_group.message_containers[0].msg.id);
                return rows.get_message_recipient_row(message_row);
            };

            compose_fade.update_rendered_message_groups(new_message_groups, get_element);
        }

        if (list === current_msg_list && messages_are_new) {
            // First, in single-recipient narrows, potentially
            // auto-scroll to the latest message if it was sent by us.
            if (narrow_state.narrowed_by_reply()) {
                var selected_id = list.selected_id();
                var i;

                // Iterate backwards to find the last message
                // sent_by_me, stopping at the pointer position.
                // There's a reasonable argument that this search
                // should be limited in how far offscreen it's willing
                // to go.
                for (i = messages.length - 1; i >= 0; i -= 1) {
                    var id = messages[i].id;
                    if (id <= selected_id) {
                        break;
                    }
                    if (messages[i].sent_by_me && list.get(id) !== undefined) {
                        // If this is a reply we just sent, advance the pointer to it.
                        list.select_id(messages[i].id, {then_scroll: true, from_scroll: true});
                        return {
                            need_user_to_scroll: false,
                        };
                    }
                }
            }

            if (started_scrolled_up) {
                return {
                    need_user_to_scroll: true,
                };
            }
            var new_messages_height = self._new_messages_height(new_dom_elements);
            var need_user_to_scroll = self._maybe_autoscroll(new_messages_height);

            if (need_user_to_scroll) {
                return {
                    need_user_to_scroll: true,
                };
            }
        }
    },

    _new_messages_height: function (rendered_elems) {
        var new_messages_height = 0;
        var id_of_last_message_sent_by_us = -1;

        // C++ iterators would have made this less painful
        _.each(rendered_elems.reverse(), function (elem) {
            // Sometimes there are non-DOM elements in rendered_elems; only
            // try to get the heights of actual trs.
            if (elem.is("div")) {
                new_messages_height += elem.height();
                // starting from the last message, ignore message heights that weren't sent by me.
                if (id_of_last_message_sent_by_us > -1) {
                    return;
                }
                var row_id = rows.id(elem);
                // check for `row_id` NaN in case we're looking at a date row or bookend row
                if (row_id > -1 &&
                    people.is_current_user(this.get_message(row_id).sender_email)) {
                    id_of_last_message_sent_by_us = rows.id(elem);
                }
            }
        }, this);

        return new_messages_height;
    },

    _scroll_limit: function (selected_row, viewport_info) {
        // This scroll limit is driven by the TOP of the feed, and
        // it's the max amount that we can scroll down (or "skooch
        // up" the messages) before knocking the selected message
        // out of the feed.
        var selected_row_top = selected_row.offset().top;
        var scroll_limit = selected_row_top - viewport_info.visible_top;

        if (scroll_limit < 0) {
            // This shouldn't happen, but if we're off by a pixel or
            // something, we can deal with it, and just warn.
            blueslip.warn('Selected row appears too high on screen.');
            scroll_limit = 0;
        }

        return scroll_limit;
    },

    _maybe_autoscroll: function (new_messages_height) {
        // If we are near the bottom of our feed (the bottom is visible) and can
        // scroll up without moving the pointer out of the viewport, do so, by
        // up to the amount taken up by the new message.
        //
        // returns `true` if we need the user to scroll

        var selected_row = this.selected_row();
        var last_visible = rows.last_visible();

        // Make sure we have a selected row and last visible row. (defensive)
        if (!(selected_row && selected_row.length > 0 && last_visible)) {
            return false;
        }

        if (new_messages_height <= 0) {
            return false;
        }

        if (!activity.client_is_active) {
            // Don't autoscroll if the window hasn't had focus
            // recently.  This in intended to help protect us from
            // auto-scrolling downwards when the window is in the
            // background and might be having some functionality
            // throttled by modern Chrome's aggressive power-saving
            // features.
            blueslip.log("Suppressing scrolldown due to inactivity");
            return false;
        }

        // do not scroll if there are any active popovers.
        if (popovers.any_active()) {
            // If a popover is active, then we are pretty sure the
            // incoming message is not from the user themselves, so
            // we don't need to tell users to scroll down.
            return false;
        }

        var info = message_viewport.message_viewport_info();
        var scroll_limit = this._scroll_limit(selected_row, info);

        // This next decision is fairly debatable.  For a big message that
        // would push the pointer off the screen, we do a partial autoscroll,
        // which has the following implications:
        //    a) user sees scrolling (good)
        //    b) user's pointer stays on screen (good)
        //    c) scroll amount isn't really tied to size of new messages (bad)
        //    d) all the bad things about scrolling for users who want messages
        //       to stay on the screen
        var scroll_amount;
        var need_user_to_scroll;

        if (new_messages_height <= scroll_limit) {
            // This is the happy path where we can just scroll
            // automatically, and the user will see the new message.
            scroll_amount = new_messages_height;
            need_user_to_scroll = false;
        } else {
            // Sometimes we don't want to scroll the entire height of
            // the message, but our callers can give appropriate
            // warnings if the message is gonna be offscreen.
            // (Even if we are somewhat constrained here, the message may
            // still end up being visible, so we do some arithmetic.)
            scroll_amount = scroll_limit;
            var offset = message_viewport.offset_from_bottom(last_visible);

            // For determining whether we need to show the user a "you
            // need to scroll down" notification, the obvious check
            // would be `offset > scroll_amount`, and that is indeed
            // correct with a 1-line message in the compose box.
            // However, the compose box is open with the content of
            // the message just sent when this code runs, and
            // `offset_from_bottom` if an offset from the top of the
            // compose box, which is about to be reset to empty.  So
            // to compute the offset at the time the user might see
            // this notification, we need to adjust by the amount that
            // the current compose is bigger than the empty, open
            // compose box.
            var compose_textarea_default_height = 42;
            var compose_textarea_current_height = $("#compose-textarea").height();
            var expected_change = compose_textarea_current_height - compose_textarea_default_height;
            var expected_offset = offset - expected_change;
            need_user_to_scroll = expected_offset > scroll_amount;
        }

        // Ok, we are finally ready to actually scroll.
        if (scroll_amount > 0) {
            message_viewport.system_initiated_animate_scroll(scroll_amount);
        }

        return need_user_to_scroll;
    },


    clear_rendering_state: function (clear_table) {
        if (clear_table) {
            this.clear_table();
        }
        this.list.last_message_historical = false;

        this._render_win_start = 0;
        this._render_win_end = 0;
    },

    update_render_window: function (selected_idx, check_for_changed) {
        var new_start = Math.max(selected_idx - this._RENDER_WINDOW_SIZE / 2, 0);
        if (check_for_changed && new_start === this._render_win_start) {
            return false;
        }

        this._render_win_start = new_start;
        this._render_win_end = Math.min(this._render_win_start + this._RENDER_WINDOW_SIZE,
                                        this.list.num_items());
        return true;
    },


    maybe_rerender: function () {
        if (this.table_name === undefined) {
            return false;
        }

        var selected_idx = this.list.selected_idx();

        // We rerender under the following conditions:
        // * The selected message is within this._RENDER_THRESHOLD messages
        //   of the top of the currently rendered window and the top
        //   of the window does not abut the beginning of the message
        //   list
        // * The selected message is within this._RENDER_THRESHOLD messages
        //   of the bottom of the currently rendered window and the
        //   bottom of the window does not abut the end of the
        //   message list
        if (!(selected_idx - this._render_win_start < this._RENDER_THRESHOLD
                && this._render_win_start !== 0 ||
               this._render_win_end - selected_idx <= this._RENDER_THRESHOLD
                && this._render_win_end !== this.list.num_items())) {
            return false;
        }

        if (!this.update_render_window(selected_idx, true)) {
            return false;
        }

        this.rerender_preserving_scrolltop();
        return true;
    },

    rerender_preserving_scrolltop: function (discard_rendering_state) {
        // old_offset is the number of pixels between the top of the
        // viewable window and the selected message
        var old_offset;
        var selected_row = this.selected_row();
        var selected_in_view = selected_row.length > 0;
        if (selected_in_view) {
            old_offset = selected_row.offset().top;
        }
        if (discard_rendering_state) {
            // If we know that the existing render is invalid way
            // (typically because messages appear out-of-order), then
            // we discard the message_list rendering state entirely.
            this.clear_rendering_state(true);
            this.update_render_window(this.list.selected_idx(), false);
        }
        return this.rerender_with_target_scrolltop(selected_row, old_offset);
    },

    set_message_offset: function (offset) {
        var msg = this.selected_row();
        message_viewport.scrollTop(message_viewport.scrollTop() + msg.offset().top - offset);
    },

    rerender_with_target_scrolltop: function (selected_row, target_offset) {
        // target_offset is the target number of pixels between the top of the
        // viewable window and the selected message
        this.clear_table();
        this.render(this.list.all_messages().slice(this._render_win_start,
                                                   this._render_win_end), 'bottom');

        // If we could see the newly selected message, scroll the
        // window such that the newly selected message is at the
        // same location as it would have been before we
        // re-rendered.
        if (target_offset !== undefined) {
            if (this.selected_row().length === 0 && this.list.selected_id() > -1) {
                this.list.select_id(this.list.selected_id(), {use_closest: true});
            }

            this.set_message_offset(target_offset);
        }
    },

    _find_message_group: function (message_group_id) {
        // Ideally, we'd maintain this data structure with a hash
        // table or at least a pointer from the message containers (in
        // either case, updating the data structure when message
        // groups are merged etc.) , but we only call this from flows
        // like message editing, so it's not a big performance
        // problem.
        return _.find(this._message_groups, function (message_group) {
            // Since we don't have a way to get a message group from
            // the containing message container, we just do a search
            // to find it.
            return message_group.message_group_id === message_group_id;
        });
    },

    _rerender_header: function (message_containers) {
        // Given a list of messages that are in the **same** message group,
        // rerender the header / recipient bar of the messages
        if (message_containers.length === 0) {
            return;
        }

        var first_row = this.get_row(message_containers[0].msg.id);

        // We may not have the row if the stream or topic was muted
        if (first_row.length === 0) {
            return;
        }

        var recipient_row = rows.get_message_recipient_row(first_row);
        var header = recipient_row.find('.message_header');
        var message_group_id = recipient_row.attr("id");

        // Since there might be multiple dates within the message
        // group, it's important to lookup the original/full message
        // group rather than doing an artificial rerendering of the
        // message header from the set of message containers passed in
        // here.
        var group = this._find_message_group(message_group_id);
        if (group === undefined) {
            blueslip.error("Could not find message group for rerendering headers");
            return;
        }

        // TODO: It's possible that we no longer need this populate
        // call; it was introduced in an earlier version of this code
        // where we constructed an artificial message group for this
        // rerendering rather than looking up the original version.
        populate_group_from_message_container(group, group.message_containers[0]);

        var rendered_recipient_row = $(render_recipient_row(group));

        header.replaceWith(rendered_recipient_row);
    },

    _rerender_message: function (message_container, message_content_edited) {
        var row = this.get_row(message_container.msg.id);
        var was_selected = this.list.selected_message() === message_container.msg;

        // Re-render just this one message
        this._maybe_format_me_message(message_container);
        this._add_msg_edited_vars(message_container);

        // Make sure the right thing happens if the message was edited to mention us.
        message_container.contains_mention = message_container.msg.mentioned;

        var rendered_msg = $(this._get_message_template(message_container));
        if (message_content_edited) {
            rendered_msg.addClass("fade-in-message");
        }
        this._post_process(rendered_msg);
        row.replaceWith(rendered_msg);

        if (was_selected) {
            this.list.select_id(message_container.msg.id);
        }
    },

    rerender_messages: function (messages, message_content_edited) {
        var self = this;

        // Convert messages to list messages
        var message_containers = _.map(messages, function (message) {
            return self.message_containers[message.id];
        });
        // We may not have the message_container if the stream or topic was muted
        message_containers = _.reject(message_containers, function (message_container) {
            return message_container === undefined;
        });

        var message_groups = [];
        var current_group = [];
        _.each(message_containers, function (message_container) {
            if (current_group.length === 0 ||
                same_recipient(current_group[current_group.length - 1], message_container)) {
                current_group.push(message_container);
            } else {
                message_groups.push(current_group);
                current_group = [];
            }
            self._rerender_message(message_container, message_content_edited);
        });
        if (current_group.length !== 0) {
            message_groups.push(current_group);
        }
        _.each(message_groups, function (messages_in_group) {
            self._rerender_header(messages_in_group, message_content_edited);
        });
    },

    append: function (messages, messages_are_new) {
        var cur_window_size = this._render_win_end - this._render_win_start;
        var render_info;

        if (cur_window_size < this._RENDER_WINDOW_SIZE) {
            var slice_to_render = messages.slice(0, this._RENDER_WINDOW_SIZE - cur_window_size);
            render_info = this.render(slice_to_render, 'bottom', messages_are_new);
            this._render_win_end += slice_to_render.length;
        }

        // If the pointer is high on the page such that there is a
        // lot of empty space below and the render window is full, a
        // newly received message should trigger a rerender so that
        // the new message, which will appear in the viewable area,
        // is rendered.
        var needed_rerender = this.maybe_rerender();

        if (needed_rerender) {
            render_info = {need_user_to_scroll: true};
        }

        return render_info;
    },

    prepend: function (messages) {
        this._render_win_start += messages.length;
        this._render_win_end += messages.length;

        var cur_window_size = this._render_win_end - this._render_win_start;
        if (cur_window_size < this._RENDER_WINDOW_SIZE) {
            var msgs_to_render_count = this._RENDER_WINDOW_SIZE - cur_window_size;
            var slice_to_render = messages.slice(messages.length - msgs_to_render_count);
            this.render(slice_to_render, 'top', false);
            this._render_win_start -= slice_to_render.length;
        }

        // See comment for maybe_rerender call in the append code path
        this.maybe_rerender();
    },

    clear_table: function () {
        // We do not want to call .empty() because that also clears
        // jQuery data.  This does mean, however, that we need to be
        // mindful of memory leaks.
        rows.get_table(this.table_name).children().detach();
        this._rows = {};
        this._message_groups = [];
        this.message_containers = {};
    },

    get_row: function (id) {
        var row = this._rows[id];

        if (row === undefined) {
            // For legacy reasons we need to return an empty
            // jQuery object here.
            return $(undefined);
        }

        return row;
    },

    clear_trailing_bookend: function () {
        var trailing_bookend = rows.get_table(this.table_name).find('.trailing_bookend');
        trailing_bookend.remove();
    },

    render_trailing_bookend: function (trailing_bookend_content, subscribed, show_button) {
        var rendered_trailing_bookend = $(render_bookend({
            bookend_content: trailing_bookend_content,
            trailing: show_button,
            subscribed: subscribed,
        }));
        rows.get_table(this.table_name).append(rendered_trailing_bookend);
    },

    selected_row: function () {
        return this.get_row(this.list.selected_id());
    },

    get_message: function (id) {
        return this.list.get(id);
    },

    change_message_id: function (old_id, new_id) {
        if (this._rows[old_id] !== undefined) {
            var row = this._rows[old_id];
            delete this._rows[old_id];

            row.attr('zid', new_id);
            row.attr('id', this.table_name + new_id);
            row.removeClass('local');
            this._rows[new_id] = row;
        }

        if (this.message_containers[old_id] !== undefined) {
            var message_container = this.message_containers[old_id];
            delete this.message_containers[old_id];
            this.message_containers[new_id] = message_container;
        }

    },

    _maybe_format_me_message: function (message_container) {
        if (message_container.msg.is_me_message) {
            // Slice the '<p>/me ' off the front, and '</p>' off the first line
            // 'p' tag is sliced off to get sender in the same line as the
            // first line of the message
            var msg_content = message_container.msg.content;
            var p_index = msg_content.indexOf('</p>');
            message_container.status_message = msg_content.slice('<p>/me '.length, p_index) +
                                                msg_content.slice(p_index + '</p>'.length);
            message_container.include_sender = true;
        } else {
            message_container.status_message = false;
        }
    },
};

}());

if (typeof module !== 'undefined') {
    module.exports = MessageListView;
}
window.MessageListView = MessageListView;
