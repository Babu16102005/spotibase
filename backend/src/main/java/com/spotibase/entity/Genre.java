package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;

import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "genres")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Genre {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, unique = true, length = 100)
    private String name;

    @Column(length = 500)
    private String imageUrl;

    @Column(length = 10)
    private String color;

    @Column(nullable = false)
    @Builder.Default
    private int sortOrder = 0;

    @OneToMany(mappedBy = "genre")
    @Builder.Default
    private Set<Song> songs = new HashSet<>();

    @OneToMany(mappedBy = "genre")
    @Builder.Default
    private Set<Album> albums = new HashSet<>();
}
