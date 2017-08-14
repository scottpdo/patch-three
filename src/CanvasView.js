import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import _ from 'lodash';

import Surface from './Surface';
import Coordinates from './Coordinates';

import { axisX, axisY, axisZ } from './utils/canvas-helpers';
import easing from './utils/easing';

const THREE = require('three');

/**
 * Responsible for maintaining app state, including the Surface,
 * handling user interactions, and drawing to the screen.
 */
export default class CanvasView extends Component {
	
	constructor() {

		super();

		/**
		 * Initial state:
		 * - no action selected (control knob does nothing)
		 * - iteration set to 0
		 * - coordinates not visible
		 * - last interaction happened at this precise moment
		 */
		this.state = {
			action: null,
			i: 0,
			coordinates: false,
			lastInteraction: new Date(),
		};

		this.surface = new Surface();

		this.actions = {
			TOGGLE: _.throttle(this.toggle.bind(this), 250),
			"←→": this.rotateCameraXY.bind(this),
			"↑↓": this.rotateCameraZ.bind(this),
			ZOOM: this.zoom.bind(this),
			X_AXIS: this.updateControlPoint.bind(this, "x"),
			Y_AXIS: this.updateControlPoint.bind(this, "y"),
			Z_AXIS: this.updateControlPoint.bind(this, "z"),
		};

		this.keys = { 
			37: "←→",			// left
			39: "←→",			// right
			38: "↑↓",			// up
			40: "↑↓",			// down
			80: "TOGGLE", // p
			67: "ZOOM", 	// c
			88: "X_AXIS", // x
			89: "Y_AXIS", // y
			90: "Z_AXIS", // z
			27: "RESTORE",// esc
		};

		/**
		 * These two numbers determine camera location.
		 * Camera is always looking at the origin with z-axis = up.
		 * See .positionCamera()
		 */
		this.azimuth = Math.PI / 8;
		this.altitude = Math.PI / 4;

		/**
		 * Bind class methods that use `this` as calling context.
		 */
		this.iter = this.iter.bind(this);
		this.checkLastInteraction = this.checkLastInteraction.bind(this);
		this.onResize = _.debounce(this.onResize.bind(this), 250); // debounced because expensive
		this.onClick = this.onClick.bind(this);
		this.onWheel = this.onWheel.bind(this);
		this.onKeyDown = this.onKeyDown.bind(this);
		this.draw = this.draw.bind(this);
		this.updateControlPoint = this.updateControlPoint.bind(this);
		this.positionCamera = this.positionCamera.bind(this);
		this.restoreSurface = this.restoreSurface.bind(this);
	}

	/**
	 * Method that increases iteration state.
	 * Useful in that it triggers .render()
	 * without any other side effects.
	 */
	iter() {
		this.setState({ i: this.state.i + 1 });
	}

	checkLastInteraction() {
		const t = new Date();
		if (t - this.state.lastInteraction > 10000) this.surface.randomizeCloseToOriginal(240, (t) => {
			this.rotateCameraXY(1.5 * easing.dEase(t));
			this.draw();
		});
		setTimeout(this.checkLastInteraction, 10000);
	}

	updateLastInteraction(cb) {
		this.setState({
			lastInteraction: new Date()
		}, cb);
	}

	onResize() {

		this.updateLastInteraction();

		const canvas = this.canvas;

		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;

		this.camera.aspect = canvas.width / canvas.height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( canvas.width, canvas.height );
		this.renderer.render(this.scene, this.camera);

		this.positionCoordinates();
	}

	onClick(e) {
		this.updateLastInteraction();
		this.surface.randomize(60, this.draw);
	}

	onKeyDown(e) {

		this.updateLastInteraction();

		const code = e.keyCode;

		if (!(code in this.keys)) return;

		let action = this.keys[code];

		if (action === this.state.action) action = null;

		if (_.isFunction(this.actions[action]) || action === null) this.setState({ action });

		// some keys should trigger changes by themselves,
		// not just setting the action for the wheel to handle
		if (action === "TOGGLE") {

			if (!this.surface.controls) {

				this.surface.activateControls();

				this.setState({ coordinates: true });
				this.positionCoordinates();
			} else {
				this.surface.setAxis(null);
				this.surface.update();
			}

		} else if (action === "X_AXIS" || action === "Y_AXIS" || action === "Z_AXIS") {
			switch (action) {
				case "X_AXIS": 
					this.surface.setAxis("x");
					break;
				case "Y_AXIS":
					this.surface.setAxis("y");
					break;
				case "Z_AXIS":
					this.surface.setAxis("z");
					break;
				default:
			}
			this.surface.update();
		} else if (action === "RESTORE") {
			this.restoreSurface();
		} else {
			this.setState({ coordinates: false });
			this.surface.deactivateControls();
		}

		this.draw();
	}

	onWheel(e) {

		e.preventDefault();

		this.updateLastInteraction();

		const action = this.state.action;

		if (!(action in this.actions)) return;

		this.actions[action](-e.deltaY);

		this.draw();
	}

	draw() {

		// a little messy, but this.surface removes all children
		// from the scene when this.surface.update() is called...
		// thus need to re-add the axes to the scene whenever the surface
		// might possibly have updated.
		this.scene.add(axisX);
		this.scene.add(axisY);
		this.scene.add(axisZ);

		this.positionCamera();
		this.positionCoordinates();

		this.renderer.render(this.scene, this.camera);
	}

	rotateCameraXY(delta) {
		let angle = 0.0008 * delta;
		this.azimuth += angle;
	}

	rotateCameraZ(delta) {
		let angle = 0.0008 * delta;
		this.altitude += angle;

		// for max altitude = PI / 2, looking straight down
		// for min altitude = -PI / 2, looking straight up
		// (higher or lower is not allowed)
		this.altitude = _.clamp(this.altitude, -Math.PI / 2, Math.PI / 2);
	}

	restoreSurface() {
		this.surface.restore(60, this.draw);
	}

	toggle(delta) {
		if (Math.abs(delta) < 10) return;
		this.surface.setActiveControlPointIndex(delta > 0 ? 1 : -1);
		this.setState({ coordinates: true });
		this.positionCoordinates();
	}

	positionCoordinates() {
		// get active control point location in screen space
		// to decide where to show NumericControls
		let pt = this.surface.getActiveControlPoint();
		if (_.isNil(pt)) return;

		const node = ReactDOM.findDOMNode(this.refs.Coordinates);
		const width = Math.round(node.getBoundingClientRect().width);
		const height = Math.round(node.getBoundingClientRect().height);

		pt = pt.clone();
		pt.project(this.camera);

		// depending on which 'quadrant' it is in,
		// move toward the outside of the screen
		const dx = (pt.x < 0 ? -1 :  1) * width  / 2 + (pt.x < 0 ? -1 :  1) * 15;
		const dy = (pt.y < 0 ?  1 : -1) * height / 2 + (pt.y < 0 ?  1 : -1) * 15;

		pt.x = Math.round(( pt.x + 1) * this.canvas.width / 4) + dx;
		pt.y = Math.round((-pt.y + 1) * this.canvas.height / 4) + dy;

		// keep it on the screen...
		// right
		if (pt.x + width / 2 > this.canvas.width) pt.x = this.canvas.width - width / 2;
		// left
		if (pt.x - width / 2 < 0) pt.x = width / 2;
		// bottom
		if (pt.y + height / 2 > this.canvas.height) pt.y = this.canvas.height - height / 2;
		// top
		if (pt.y - height / 2 < 0) pt.y = height / 2;

		this.setState({
			coordinatesX: pt.x,
			coordinatesY: pt.y,
		});
	}

	updateControlPoint(axis, delta) {

		const p = this.surface.getActiveControlPoint();
		if (_.isNil(p)) return;

		let q = p.clone(); 
		q[axis] += 0.005 * delta;

		this.surface.setActiveControlPoint(q, axis);
		this.surface.update();
		this.positionCoordinates();
		this.draw();
	}

	positionCamera() {

		let x = 2 * Math.cos(this.azimuth) * Math.cos(this.altitude);
		let y = 2 * Math.sin(this.azimuth) * Math.cos(this.altitude);
		let z = 2 * Math.sin(this.altitude);

		this.camera.position.set(x, y, z);
		this.camera.lookAt(new THREE.Vector3(0, 0, 0));

		this.camera.up = new THREE.Vector3(0, 0, 1);

		this.camera.updateProjectionMatrix();
	}

	zoom(delta) {
		const zoomOut = delta < 0;     // boolean
    const factor = zoomOut ? 1.1 : 0.9; // number
    this.camera.zoom *= factor;
    this.camera.updateProjectionMatrix();
	}

	componentDidMount() {

		// set up canvas
		const canvas = this.refs.canvas;
		this.canvas = canvas;

		// set up scene, camera, renderer
		this.scene = new THREE.Scene();
		
		this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);

		this.renderer = new THREE.WebGLRenderer({
			canvas: this.refs.canvas,
			antialias: true
		});

		this.renderer.setPixelRatio( window.devicePixelRatio );
		this.renderer.setSize( window.innerWidth, window.innerHeight );
		
		this.onResize();

		this.surface.setScene(this.scene);
		this.surface.update();
		
		// even though .draw() calls .positionCamera(), for some reason if we don't
		// call it here, camera is messed up at beginning
		// TODO: probably should figure this out :-|
		this.positionCamera();

		this.draw();

		this.checkLastInteraction();

		// add event listeners
		window.addEventListener('resize', this.onResize);
		this.refs.canvas.addEventListener('click', this.onClick);
    this.refs.canvas.addEventListener('wheel', this.onWheel.bind(this));
    window.addEventListener('keydown', this.onKeyDown.bind(this));
	}

	render() {

		const coordinatesStyle = {
			display: this.state.coordinates ? 'block' : 'none',
			left: this.state.coordinatesX,
			top: this.state.coordinatesY,
		};

		const actionStyle = {
			left: 20,
			top: 20,
			position: 'absolute',
			color: '#fff',
			fontFamily: 'monospace'
		};

		return (
			<div>
				<canvas ref="canvas" />
				<Coordinates 
					ref="Coordinates"
					surface={this.surface} 
					style={coordinatesStyle}
					active={this.state.coordinates} />
				<div style={actionStyle}>{this.state.action}</div>
			</div>
		)
	}
};