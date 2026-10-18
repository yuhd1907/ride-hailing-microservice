package com.rideflow.notification.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

	record PingResponse(String service, String status) {
	}

	@GetMapping("/ping")
	public PingResponse ping() {
		return new PingResponse("notification-service", "UP");
	}
}
