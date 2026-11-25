package com.ridehail.notificationservice.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

/**
 * Thông báo chung của nền tảng gửi theo nhóm người nhận (ALL, PASSENGER, DRIVER): chính
 * sách, bảo trì, khuyến mãi, tin tức.
 */
@Entity
@Table(name = "announcements")
public class Announcement {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "audience", length = 20, nullable = false)
    private String audience;

    @Column(name = "category", length = 20, nullable = false)
    private String category;

    @Column(name = "title", length = 150, nullable = false)
    private String title;

    @Column(name = "content", nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "pinned", nullable = false)
    private boolean pinned;

    @Column(name = "published_at", nullable = false, columnDefinition = "timestamptz")
    private Instant publishedAt;

    @Column(name = "expires_at", columnDefinition = "timestamptz")
    private Instant expiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    protected Announcement() {
    }

    public Announcement(String audience, String category, String title, String content, boolean pinned,
            Instant publishedAt, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.audience = audience;
        this.category = category;
        this.title = title;
        this.content = content;
        this.pinned = pinned;
        this.publishedAt = publishedAt;
        this.expiresAt = expiresAt;
    }

    public UUID getId() {
        return this.id;
    }

    public String getAudience() {
        return this.audience;
    }

    public String getCategory() {
        return this.category;
    }

    public String getTitle() {
        return this.title;
    }

    public String getContent() {
        return this.content;
    }

    public boolean isPinned() {
        return this.pinned;
    }

    public Instant getPublishedAt() {
        return this.publishedAt;
    }

    public Instant getExpiresAt() {
        return this.expiresAt;
    }

}
