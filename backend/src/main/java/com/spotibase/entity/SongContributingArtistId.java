package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;

import java.io.Serializable;

@Embeddable
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SongContributingArtistId implements Serializable {

    @Column(name = "song_id", length = 36)
    private String songId;

    @Column(name = "artist_id", length = 36)
    private String artistId;

    @Column(name = "role", length = 50)
    private String role; // ContributionRole as string
}