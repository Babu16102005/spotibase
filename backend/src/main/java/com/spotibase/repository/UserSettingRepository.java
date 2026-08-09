package com.spotibase.repository;

import com.spotibase.entity.UserSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UserSettingRepository extends JpaRepository<UserSetting, String> {

    Optional<UserSetting> findByUserId(String userId);
}
