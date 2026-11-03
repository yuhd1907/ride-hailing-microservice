package com.ridehail.driverservice.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.data.geo.Circle;
import org.springframework.data.geo.Distance;
import org.springframework.data.geo.GeoResult;
import org.springframework.data.geo.GeoResults;
import org.springframework.data.geo.Metrics;
import org.springframework.data.geo.Point;
import org.springframework.data.redis.connection.RedisGeoCommands;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.ridehail.driverservice.dto.response.NearbyDriverResult;
import com.ridehail.driverservice.service.DriverLocationRedisService;
import com.ridehail.driverservice.util.GeoValidation;

/**
 * Dịch vụ Định vị Tọa độ Siêu tốc qua Redis GEO
 *
 * Redis GEO sử dụng Sorted Set + Geohash để lưu tọa độ GPS Cho phép GEOADD (cập nhật) và
 * GEOSEARCH (tìm kiếm bán kính) với độ trễ < 1ms
 */
@Service
public class DriverLocationRedisServiceImpl implements DriverLocationRedisService {

    private static final Logger log = LoggerFactory.getLogger(DriverLocationRedisServiceImpl.class);

    private final StringRedisTemplate redisTemplate;

    private static final String GEO_KEY = "driver:locations";

    public DriverLocationRedisServiceImpl(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Cập nhật vị trí GPS tài xế vào Redis GEO Lệnh Redis: GEOADD driver:locations
     * <longitude> <latitude> <driverId> Độ trễ: < 1ms
     */
    @Override
    public void updateLocation(UUID driverId, double latitude, double longitude) {
        MDC.put("driverId", driverId.toString());
        GeoValidation.coordinates(latitude, longitude);
        redisTemplate.opsForGeo()
            .add(GEO_KEY, new Point(longitude, latitude), // Redis nhận thứ tự (kinh độ,
                                                          // vĩ độ)
                    driverId.toString());
        log.debug("Redis GEO: Cập nhật vị trí driverId={} -> lat={}, lng={}", driverId, latitude, longitude);
    }

    /**
     * Tìm danh sách ID tài xế trong bán kính R km quanh tọa độ khách hàng Lệnh Redis:
     * GEOSEARCH driver:locations FROMLONLAT <lng> <lat> BYRADIUS <R> km ASC Kết quả sắp
     * xếp từ gần nhất đến xa nhất Độ trễ: < 1ms
     */
    @Override
    public List<NearbyDriverResult> findNearbyDrivers(double latitude, double longitude, double radiusKm) {
        GeoValidation.search(latitude, longitude, radiusKm);
        Circle searchArea = new Circle(new Point(longitude, latitude), new Distance(radiusKm, Metrics.KILOMETERS));

        RedisGeoCommands.GeoRadiusCommandArgs args = RedisGeoCommands.GeoRadiusCommandArgs.newGeoRadiusArgs()
            .includeDistance()
            .sortAscending(); // Sắp xếp từ tài xế gần nhất đến xa nhất

        GeoResults<RedisGeoCommands.GeoLocation<String>> results = redisTemplate.opsForGeo()
            .radius(GEO_KEY, searchArea, args);

        List<NearbyDriverResult> nearbyDrivers = new ArrayList<>();
        if (results != null) {
            for (GeoResult<RedisGeoCommands.GeoLocation<String>> result : results) {
                UUID driverId = UUID.fromString(result.getContent().getName());
                double distanceKm = result.getDistance().getValue();
                nearbyDrivers.add(new NearbyDriverResult(driverId, distanceKm));
            }
        }

        log.debug("Redis GEO: Tìm thấy {} tài xế trong bán kính {}km quanh ({}, {})", nearbyDrivers.size(), radiusKm,
                latitude, longitude);
        return nearbyDrivers;
    }

    /**
     * Xóa tài xế khỏi danh sách hoạt động khi tắt ứng dụng (OFFLINE) Lệnh Redis: ZREM
     * driver:locations <driverId>
     */
    @Override
    public void removeDriver(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        redisTemplate.opsForZSet().remove(GEO_KEY, driverId.toString());
        log.debug("Redis GEO: Xóa driverId={} khỏi danh sách vị trí", driverId);
    }

}
