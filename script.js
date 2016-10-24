
$(document).ready(function() {

	var w = $(window).width(),
	    h = $(window).height(),
	    routes = {},
	    city = {
	    	lon: 122.4417686,
	    	lat: 37.7682044
	    };

	//Provides x and y given lat and long.
	var proj = d3.geo.albers() 
		  .scale(200000)
	      .translate([w*3/8, h/2]) 	       
	      .rotate([city.lon, 0]) 
	      .center([0, city.lat]); 

	var path = d3.geo.path().projection(proj);

	var line = d3.svg.line()
                     .x(function(d) { return proj([d.lon, d.lat])[0]; })
                     .y(function(d) { return proj([d.lon, d.lat])[1]; })
                     .interpolate("linear");

    //For zoom functionality on map
	var zoom = d3.behavior.zoom()
		.scale(proj.scale())
		.scaleExtent([200000,3500000])
		.translate(proj.translate())
		.on("zoom", function() {
			proj.translate(d3.event.translate).scale(d3.event.scale);
			svg.selectAll(".mapoverlay").attr("d", path);
			svg.selectAll(".route_path").attr("d", function(d) {
				return line(d.point);
			});
			svg.selectAll(".drawn_vehicle").attr("cx", function(d) {
			    return proj([d.lon, d.lat])[0];
			});
			svg.selectAll(".drawn_vehicle").attr("cy", function(d) {
			    return proj([d.lon, d.lat])[1];
			});
			svg.selectAll(".vehiclemarkers").attr("transform", "");
	});

	var svg = d3.select("#map").insert("svg").attr("width", w*3/4).attr("height", h);
	svg.call(zoom);
	//Combined file for all maps.
	load_svg_data("sfmaps/mixed_all.json", "mapoverlay"); 
	
	//Array for trains
	var route_for_lrails = ['F', 'J', 'KT', 'L', 'M', 'N', 'S'];

	//Grab all initial route info
	route_grab = "sf-muni";
	grabRoutes(route_grab);
	setTimeout(listenerCall, 1800);

	// Call to grab new locations every 15s
	// Done on selected routes only.
	run_update_15();
	setInterval(chosenRoutes, 15000);

	// Maintain updated display consistency
	setTimeout(function() {
		routeDrawingSelected(route_grab);
		setInterval(updateByRefresh, 300);
	}, 1500);


	/*
	* Gets configuration details for each route_tag in agency
	*
	* agency_tag is a unique identifier for transit type
	* route_tag is a unique identifier for route
	*/
	function grabConfigForRoutes(agency_tag, route_tag) {
		qs = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=" + agency_tag + "&r=" + route_tag; 
		var retry = 0;

		do {
			d3.xml(qs, function(error, xml) {
				if (error) { retry = 1; return; }
				
				var json = $.xml2json(xml);
				routes[agency_tag]['routes'][route_tag] = json.route;
				routes[agency_tag]['routes'][route_tag]['last_time'] = 0;
				routes[agency_tag]['routes'][route_tag]['poll'] = false;
				var rp_button = "<div id='routepicker_" + route_tag + "' class='button toggle_specific_route'>" + route_tag + "</div>";
				if ($.inArray(route_tag, route_for_lrails) != -1) {
					$("#route_lightrail").append(rp_button);
				} else {
					$("#route_bus").append(rp_button);
				}

				obtainRouteFromVehicles(route_grab, route_tag);
			});
		} while(retry);
	}

	/*
	* Grab route list
	*
	* agency_tag is a unique identifier.
	*/
	function grabRoutes(agency_tag) {
		var qs = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeList&a=" + agency_tag;
		var retry = 0;

		routes[agency_tag] = {};
		routes[agency_tag]['routes'] = {}
		do {
			d3.xml(qs, function(error, xml) {
				if (error) { retry = 1; return; }

				var json = $.xml2json(xml);
				$.each(json['route'], function(i,d) {
					grabConfigForRoutes(agency_tag, d.tag);
				});
			});
		} while(retry);
	}

	/*
	* Gets the vehicle information, including locations, for route
	*
	* agency_tag - unique identifier for transit agency
	* route_tag  - unique route identifier
	*/
	function obtainRouteFromVehicles(agency_tag, route_tag) {

		var qs = "http://webservices.nextbus.com/service/publicXMLFeed?command=vehicleLocations&a=" + agency_tag + "&r=" + route_tag + "&t=" + routes[agency_tag]['routes'][route_tag]['last_time'];
		var retry = 0;
		do {
			d3.xml(qs, function(error, xml) {
				if (error) { retry = 1; return; }
				json = $.xml2json(xml);

				// update last_time to the one in this response
				routes[agency_tag]['routes'][route_tag]['last_time'] = json['lastTime']['time'];

				// merge any previous vehicles with batch. Match by vehicle id key
				var vehicles;
				if (typeof routes[agency_tag]['routes'][route_tag]['vehicles'] == 'undefined') {
					routes[agency_tag]['routes'][route_tag]['vehicles'] = [];
				}
				vehicles = routes[agency_tag]['routes'][route_tag]['vehicles'];

				if (typeof json.vehicle !== 'undefined') {
					for (var i=0; i<json.vehicle.length; i++) {
						var isnew = true;
						for (var j=0; j<vehicles.length; j++) {
							// update the matched vehicles
							if (vehicles[j]['id'] == json.vehicle[i]['id']) {
								json.vehicle[i].lon_init = vehicles[j].lon_init;
								json.vehicle[i].lat_init = vehicles[j].lat_init;
								vehicles[j] = json.vehicle[i];
								isnew = false;
								break;
							} else {
								continue;
							}
						}
						// Add the new vehicle if necessary
						if (isnew) {
							json.vehicle[i].lon_init = json.vehicle[i].lon;
							json.vehicle[i].lat_init = json.vehicle[i].lat;
							routes[agency_tag]['routes'][route_tag]['vehicles'].push(json.vehicle[i]);
						}
					}
				}
			});
		} while (retry);
	}

	/*
	* Retrieve information for routes that user has selected
	*
	* We are keeping track of selections in the boolean: routes[agency]['routes'][route]['poll']
	*
	*/
	function chosenRoutes() {

		$.each(routes[route_grab]['routes'], function(i,d) {
			if (d['poll']) {
				obtainRouteFromVehicles(route_grab, d.tag);
			}
		});
		run_update_15();
	}

	/*
	* Reads from data in memory and updates svg elements
	*
	*/
	function updateByRefresh() {
		$.each(routes[route_grab]['routes'], function(i,d) {
				displayVehiclesForRoute(route_grab, d.tag);
		});
	}

	/*
	* Draws a line along the path that each bus route travels
	*/
	function routeDrawingSelected(agency_tag, route_tag) {
		$.each(routes[agency_tag]['routes'], function(i,route) {
			var p = svg.selectAll("path.route")
		       .data(routes[agency_tag]['routes'][route.tag]['path'])
		       .enter()
		       .append("path")
		       .attr("d", function(d) {
		       		return line(d.point);
		       	})
		       .attr("class", "route_path route_path_" + route.tag)
		       .attr("visibility", "hidden")
		       .attr("stroke", "#" + routes[agency_tag]['routes'][route.tag]['color'])
		       .attr("stroke-width", 0.7)
		       .attr("fill", 'none');
		});
	}

	/*
	* Update SVGs
	*
	* D3 updates handles with .enter and .exit
	*
	*/
	function displayVehiclesForRoute(agency_tag, route_tag) {

		var vehicles = svg.selectAll(".route_" + route_tag)
			.data(routes[agency_tag]['routes'][route_tag]['vehicles']);

			
		vehicles
		    .transition()
		    .duration(400)
		    .ease('linear')

			.attr("transform", function(d) {
				return build_vehicle_transform(d.lon, d.lat, d.lon_init, d.lat_init);
			});


		vehicles.enter()
			.append('g')
			  	.attr("class", function(d) {
					return "vehiclemarkers route_" + route_tag;
			  	})
			  	.attr("id", function(d) {
					return "vehicle_" + d.id;
				})
			  	.attr("visibility", function(){
			  		if (routes[agency_tag]['routes'][route_tag]['poll']) {
			  			return "visible";
			  		} else {
			  			return "hidden";
			  		}
			  	})
		  	.append("circle")
		  		.attr("class", "drawn_vehicle")
		    	.attr("cx", function(d) {
		            return proj([d.lon, d.lat])[0];
		        })
		        .attr("cy", function(d) {
		            return proj([d.lon, d.lat])[1];
		        })
		    	.attr("r", 3)
		    	.attr("fill", "#" + routes[agency_tag]['routes'][route_tag]['color'])

		vehicles.exit().remove();
	}

	/*
	* Loading GeoJSON sources (SF maps)
	*/
	function load_svg_data(json_src, html_class) {
		d3.json(json_src, function(d) {
		    svg.selectAll("path")
		       .data(d.features)
		       .enter()
		       .append("path")
		       .attr("d", path)
		       .attr("class", html_class);
		});
	}

	function listenerCall() {

		$(".toggle_all_routes").on('click', function() {
			if ($(this).hasClass("selected")) {
				$(this).removeClass("selected");
				$(this).text('View All');
				$(".toggle_specific_route").removeClass("selected");

				$.each(routes[route_grab]['routes'], function(i,d) {
					hideVehicles(d.tag);
				});

			} else {
				$(this).addClass("selected");
				$(this).text('View None');
				$(".toggle_specific_route").addClass("selected");
				$.each(routes[route_grab]['routes'], function(i,d) {
					showVehicles(d.tag);
				});
			}
		});

		$(".toggle_specific_route").on("click", function() {

			var route_tag = $(this).attr("id").replace("routepicker_","");

			if ($(this).hasClass("selected")) {
				$(this).removeClass("selected");

				hideVehicles(route_tag);
			} else {
				$(this).addClass("selected");

				showVehicles(route_tag);
				$('#get_started').popover('destroy');
			}
			return false;
		});
	}

	/*
	* Toggle visibility of route markers and paths
	*
	*/
	function hideVehicles(route_tag) {

		routes[route_grab]['routes'][route_tag]['poll'] = false;

		$(".route_"+route_tag).css({
			"visibility": "hidden"
		});


		$(".route_path_"+route_tag).css({
			"visibility": "hidden"
		});


		$("#routepicker_"+route_tag).css({
			"background-color": "#fff",
			"color": "black"
		});
	}

	function showVehicles(route_tag) {
		routes[route_grab]['routes'][route_tag]['poll'] = true;

		$(".route_"+route_tag).css({
			"visibility": "visible"
		});

		$(".route_path_"+route_tag).css({
			"visibility": "visible"
		});

		$("#routepicker_"+route_tag).css({
			"background-color": "#" + routes[route_grab]['routes'][route_tag]['color'],
			"color": "#" + routes[route_grab]['routes'][route_tag]['oppositeColor']
		});
	}

	/*
	* Building the transform property.
	* For zoom, moving map, display
	*/
	function build_vehicle_transform(lon, lat, lon_init, lat_init) {
		var t = "translate(" + (proj([lon, lat])[0] - proj([lon_init, lat_init])[0]) + "," + (proj([lon, lat])[1] - proj([lon_init, lat_init])[1]) + ")";
		return t;
	}

	/*
	* Simple Countdown timer for page update.
	* 
	* 
	*/
	function run_update_15() {
	    var t = 15;	        
	    var i = setInterval(function() {
		    $("#next_update").text("Next update in " + t + " seconds");
		    t -= 1;
		    if (t == 0) {
		        clearInterval(i);
		        return
		    }
		}, 1000);
	}
});

