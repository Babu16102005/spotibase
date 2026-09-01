package com.spotibase.ai;

public enum AssistantAction {
    // Playback
    PLAY,
    PAUSE,
    RESUME,
    NEXT,
    PREVIOUS,

    // Search / Play
    PLAY_SONG,
    SEARCH_SONG,
    SEARCH_ARTIST,
    SEARCH_ALBUM,

    // Mood / discovery
    PLAY_BY_MOOD,
    PLAY_BY_GENRE,
    PLAY_BY_LANGUAGE,
    PLAY_SIMILAR,

    // Queue
    ADD_TO_QUEUE,
    REMOVE_FROM_QUEUE,
    CLEAR_QUEUE,

    // Likes
    LIKE_CURRENT,
    UNLIKE_CURRENT,

    // Playlist
    ADD_TO_PLAYLIST,
    REMOVE_FROM_PLAYLIST,
    CREATE_PLAYLIST,

    // Player settings
    SHUFFLE_ON,
    SHUFFLE_OFF,
    REPEAT_ON,
    REPEAT_OFF,
    SET_VOLUME,

    // Info
    GET_CURRENT_SONG,
    GET_QUEUE,
    GET_RECOMMENDATIONS,

    // Clarification
    CLARIFICATION_NEEDED
}
