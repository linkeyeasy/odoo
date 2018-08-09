odoo.define('mail.model.Thread', function (require) {
"use strict";

var emojis = require('mail.emojis');
var AbstractThread = require('mail.model.AbstractThread');
var mailUtils = require('mail.utils');

var Mixins = require('web.mixins');
var ServicesMixin = require('web.ServicesMixin');

/**
 * This is the super class modeling threads in JS.
 * Such threads are stored in the mail manager, and any piece of JS code whose
 * logic relies on threads must ideally interact with such objects.
 *
 * In particular, channels and mailboxes are two different kinds of threads.
 */
var Thread = AbstractThread.extend(Mixins.EventDispatcherMixin, ServicesMixin, {

    /**
     * @override
     * @param {Object} params
     * @param {mail.Manager} params.parent
     * @param {Object} params.data
     * @param {string} [params.data.channel_type]
     * @param {string} params.data.name
     * @param {string} [params.data.type]
     */
    init: function (params) {
        Mixins.EventDispatcherMixin.init.call(this, arguments);
        this.setParent(params.parent);
        this._super.apply(this, arguments);
        // threads are not detached by default
        this._detached = false;
        // if this._massMailing is set, display subject on messages, use
        // extended composer and show "Send by messages by email" on discuss
        // sidebar
        this._massMailing = false;
        // on 1st request to getPreview, fetch data if incomplete. Otherwise it
        // means that there is no message in this channel.
        this._previewed = false;
        this._type = params.data.type || params.data.channel_type;
        // max number of fetched messages from the server
        this._FETCH_LIMIT = 30;
    },

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * Add a message to this thread.
     *
     * @abstract
     * @param {mail.model.Message} message
     */
    addMessage: function (message) {},
    /**
     * Updates the _detached state of the thread. Must be overriden to reflect
     * the new state in the interface.
     */
    close: function () {
        this._detached = false;
        this._folded = false;
        this._warnUpdatedWindowState();
    },
    /**
     * Updates the _detached state of the thread. Must be overriden to reflect
     * the new state in the interface.
     *
     * @param {Object} [options={}]
     * @param {boolean} [options.keepFoldState=false] if set, keep the fold state
     *   of this thread. Otherwise unfold it while detaching it.
     * @param {boolean} [options.passively=false] if set, if the thread window
     *   will be created passively.
     */
    detach: function (options) {
        options = options || {};
        this._detached = true;
        this._folded = options.keepFoldState ? this._folded : false;
        this._warnUpdatedWindowState({
            passively: options.passively,
        });
    },
    /**
     * Fetch the list of messages in this thread.
     * By default, a thread has no messages.
     *
     * Note that this method only returns some messages, as we do not want to
     * fetch all messages of a thread at once, just to read the last message.
     *
     * As a result, this method fetches only some messages of the thread,
     * starting from the last message in the thread. At most, it fetches
     * `this.LIMIT` number of messages at a time.
     *
     * @abstract
     * @returns {$.Promise<mail.model.Message[]>}
     */
    fetchMessages: function () {
        return $.when([]);
    },
    /**
     * Updates the folded state of the thread. Must be overriden to reflect
     * the new state in the interface.
     *
     * @override
     * @param {boolean} folded
     */
    fold: function (folded) {
        this._super.apply(this, arguments);
        this._detached = true; // auto-detach the thread
        this._warnUpdatedWindowState();
    },
    /**
     * Get the list of available commands for the thread.
     * By default, threads do not have any available command.
     *
     * @returns {Array}
     */
    getCommands: function () {
        return [];
    },
    /**
     * Get the listeners of the thread.
     * By default, a thread has not listener.
     *
     * @abstract
     * @returns {$.Promise<Object[]>}
     */
    getMentionPartnerSuggestions: function () {
        return $.when([]);
    },
    /**
     * Returns the information required to render the preview of this channel.
     *
     * @returns {Object} a valid object for the rendering of previews
     *   (@see mail.Preview template)
     */
    getPreview: function () {
        return {
            id: this.getID(),
            imageSRC: '/mail/static/src/img/smiley/avatar.jpg',
            isChat: this.isChat(),
            status: this.getStatus(),
            title: this.getName(),
            unreadCounter: this.getUnreadCounter(),
        };
    },
    /**
     * @returns {string}
     */
    getType: function () {
        return this._type;
    },
    /**
     * State whether this channel has been previewed
     *
     * A channel that has been previewed means that it had the necessary data
     * to display its preview format. A channel needs its meta data and the
     * last message in order to build its preview format.
     *
     * This is useful in order to not fetch preview info on this channel more
     * than once on channels that have no message at all.
     *
     * Any received message updates the last_message, so a channel should
     * always have all the necessary information to display its preview after
     * the 1st time.
     *
     * @returns {boolean}
     */
    hasBeenPreviewed: function () {
        return this._previewed;
    },
    /**
     * State whether there are unread messages in this thread
     *
     * @returns {boolean}
     */
    hasUnreadMessages: function () {
        return this._unreadCounter !== 0;
    },
    /**
     * Increments the needaction counter of this thread
     * FIXME: this method makes only sense for channels. Not sure, but I think
     * this method is necessary at this level because of the model
     * im_support.SupportChannel
     *
     * @abstract
     */
    incrementNeedactionCounter: function () {},
    /**
     * Increment the unread counter of this thread by 1 unit, and warn that the
     * counter has been changed.
     *
     * @override
     */
    incrementUnreadCounter: function () {
        this._super.apply(this, arguments);
        this._warnUpdatedUnreadCounter();
    },
    /**
     * States whether the thread should be auto-selected on creation
     *
     * Note that this is not of the responsibility of the thread: it only
     * provides guidance for the object that uses threads (e.g. mail.Discuss
     * must listen on threads and auto-select the thread if autoswitch is set).
     *
     * By default, threads are not in autoswitch mode.
     *
     * @returns {boolean}
     */
    isAutoswitch: function () {
        return false;
    },
    /**
     * States whether this thread is a channel or not. A thread is a channel if
     * it is an instance of mail.model.Channel (direct or indirect).
     * By default, any thread is not a channel
     *
     * @returns {boolean}
     */
    isChannel: function () {
        return false;
    },
    /**
     * States whether this thread is a chat or not. In particular, public and
     * private channels are not chat, but DMs and Livechats are chats. Chats
     * are threads used for communication between two users.
     * By default, any thread is not a chat
     *
     * @returns {boolean}
     */
    isChat: function () {
        return false;
    },
    /**
     * States whether this thread is detached or not.
     * A thread that is detached must have a thread window linked to itself.
     *
     * @return {boolean}
     */
    isDetached: function () {
        return this._detached;
    },
    /**
     * States whether the thread is linked to a document
     * By default, threads are not linked to a document.
     *
     * @returns {boolean}
     */
    isLinkedToDocument: function () {
        return false;
    },
    /**
     * States whether this thread has the mass mailing setting active or not.
     * This is a server-side setting, that determine the type of composer that
     * is used (basic or extended composer).
     *
     * @return {boolean}
     */
    isMassMailing: function () {
        return this._massMailing;
    },
    /**

     * States whether the thread is moderated or not.
     * By default, threads are not moderated.
     *
     * @returns {boolean}
     */
    isModerated: function () {
        return false;
    },
    /**
     * States whether the current user is moderator of this thread.
     * By default, the current user is not moderator of this thread.
     *
     * @returns {boolean}
     */
    isModerator: function () {
        return false;
    },
    /**
     * Mark this channel as previewed
     *
     * This is useful in order to not fetch preview info on this channel
     * is the server has no preview in the first place.
     *
     * Note: preview fetch is useful only when the channel contains messages
     * that have not been fetched at all. After that, this channel instance
     * is updated regularly so that the most up-to-date info are available
     * to make the preview of this channel.
     */
    markAsPreviewed: function () {
        this._previewed = true;
    },
    /**
     * Mark the thread as read, which resets the unread counter to 0.
     *
     * @returns {$.Promise} resolved
     */
    markAsRead: function () {
        if (this._unreadCounter > 0) {
            this.resetUnreadCounter();
        }
        return $.when();
    },
    /**
     * Post a message on the thread.
     *
     * This method must be completed by concrete threads,
     * As it currently only pre-process the messages at the moment.
     *
     * @abstract
     * @param {Object} data
     * @returns {$.Promise<Object>} resolved with the message object to be sent
     *   to the server
     */
    postMessage: function (data) {
        // This message will be received from the mail composer as html content
        // subtype but the urls will not be linkified. If the mail composer
        // takes the responsibility to linkify the urls we end up with double
        // linkification a bit everywhere. Ideally we want to keep the content
        // as text internally and only make html enrichment at display time but
        // the current design makes this quite hard to do.
        var body = mailUtils.parseAndTransform(_.str.trim(data.content), mailUtils.addLink);
        body = this._generateEmojis(body);
        var messageData = {
            partner_ids: data.partner_ids,
            body: body,
            attachment_ids: data.attachment_ids,
        };
        if ('subject' in data) {
            messageData.subject = data.subject;
        }
        return $.when(messageData);
    },
    /**
     * Overrides the method so that it also warns that the counter has been
     * changed on this thread.
     *
     * @override
     * @private
     */
    resetUnreadCounter: function () {
        this._super.apply(this, arguments);
        this._warnUpdatedUnreadCounter();
    },

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * @abstract
     * @private
     * @return {$.Promise}
     */
    _fetchMessages: function () {
        return $.when();
    },
    /**
     * Replace character representations of emojis by their unicode
     * representation in the provided HTML string. Note that the provided html
     * string is altered by this function.
     *
     * @param {string} htmlString
     * @returns {string}
     */
    _generateEmojis: function (htmlString) {
        _.each(emojis, function (emoji) {
            _.each(emoji.sources, function (source) {
                var escapedSource = String(source).replace(/([.*+?=^!:${}()|[\]/\\])/g, '\\$1');
                var regexp = new RegExp("(\\s|^)(" + escapedSource + ")(?=\\s|$)", 'g');
                htmlString = htmlString.replace(regexp, '$1' + emoji.unicode);
            });
        });
        return htmlString;
    },
    /**
     * Warn on the chat bus that the unread counter has been updated
     *
     * @private
     */
    _warnUpdatedUnreadCounter: function () {
        this.call('mail_service', 'getMailBus')
            .trigger('update_thread_unread_counter', this);
    },
    /**
     * Warn other mail components that the window state of this thread has
     * changed (it has become closed, folded, unfolded, detached, etc.)
     *
     * @private
     * @param {Object} [options={}]
     */
    _warnUpdatedWindowState: function (options) {
        options = options || {};
        this.call('mail_service', 'updateThreadWindow', this.getID(), options);
    },
});

return Thread;

});
