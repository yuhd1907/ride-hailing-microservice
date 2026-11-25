package com.ridehail.notificationservice.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import com.ridehail.notificationservice.entity.Announcement;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AnnouncementRepository extends JpaRepository<Announcement, UUID> {

    /** Thông báo đang hiệu lực cho các nhóm người nhận; ghim lên đầu, mới nhất trước. */
    @Query("select a from Announcement a where a.audience in :audiences and a.publishedAt <= :now "
            + "and (a.expiresAt is null or a.expiresAt > :now) order by a.pinned desc, a.publishedAt desc")
    List<Announcement> findVisible(@Param("audiences") Collection<String> audiences, @Param("now") Instant now,
            Pageable pageable);

}
