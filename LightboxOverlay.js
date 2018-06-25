import React, { Component, Children, cloneElement } from 'react';
import PropTypes from 'prop-types';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Easing
} from 'react-native';
import Image from "react-native-fast-image";
import { DEVICE } from "../../src/constants/device";

const WINDOW_HEIGHT = Dimensions.get('window').height;
const WINDOW_WIDTH = Dimensions.get('window').width;
const DRAG_DISMISS_THRESHOLD = 80;
const DRAG_SWIPE_THRESHOLD = WINDOW_WIDTH / 5;
// const STATUS_BAR_OFFSET = (Platform.OS === 'android' ? -25 : 0);
const isIOS = Platform.OS === 'ios';

const styles = StyleSheet.create({
  background    : {
    position: 'absolute',
    top     : 0,
    left    : 0,
    width   : WINDOW_WIDTH,
    height  : WINDOW_HEIGHT,
  },
  open          : {
    position       : 'absolute',
    flex           : 1,
    justifyContent : 'center',
    // Android pan handlers crash without this declaration:
    backgroundColor: 'transparent',
  },
  header        : {
    position       : 'absolute',
    top            : 0,
    left           : 0,
    width          : WINDOW_WIDTH,
    backgroundColor: 'transparent',
  },
  footer        : {
    position       : 'absolute',
    bottom         : 0,
    left           : 0,
    width          : WINDOW_WIDTH,
    backgroundColor: 'transparent',
  },
  closeButtonBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius   : 20,
    height         : 35,
    width          : 35,
    marginLeft     : 13,
    marginTop      : 8,
  },
  closeButton   : {
    fontSize     : 35,
    fontWeight   : '200',
    color        : 'white',
    lineHeight   : 35,
    width        : 35,
    textAlign    : 'center',
    shadowOffset : {
      width : 0,
      height: 0,
    },
    shadowRadius : 1.5,
    shadowColor  : 'black',
    shadowOpacity: 0.8,
  },
});


export default class LightboxOverlay extends Component {
  static propTypes = {
    origin         : PropTypes.shape({
      x     : PropTypes.number,
      y     : PropTypes.number,
      width : PropTypes.number,
      height: PropTypes.number,
    }),
    springConfig   : PropTypes.shape({
      tension : PropTypes.number,
      friction: PropTypes.number,
    }),
    backgroundColor: PropTypes.string,
    isOpen         : PropTypes.bool,
    renderHeader   : PropTypes.func,
    onOpen         : PropTypes.func,
    onClose        : PropTypes.func,
    willClose      : PropTypes.func,
    swipeToDismiss : PropTypes.bool,
    scalable       : PropTypes.bool, // can be zoomed or not
  };

  static defaultProps = {
    springConfig   : { tension: 30, friction: 7 },
    backgroundColor: 'black',
    scalable       : true,
  };

  state = {
    isAnimating : false,
    isPanning   : false,
    isReleaseing: false,
    isSwiping   : false,
    target      : {
      x      : 0,
      y      : 0,
      opacity: 1,
    },
    pan         : new Animated.Value(0),
    openVal     : new Animated.Value(0),
    footerAni   : new Animated.Value(0),
    // for scalable
    scale       : 1,
    lastScale   : 1,
    offsetX     : 0,
    offsetY     : 0,
    lastX       : 0,
    lastY       : 0,

    currentChildren: this.props.children,
  };

  distant = 150;
  delay = 300;
  radius = 20;
  prevTouchInfo = {
    prevTouchX        : 0,
    prevTouchY        : 0,
    prevTouchTimeStamp: 0,
  };
  isReleaseing = false;
  preScale = 1;

  getContent = () => {
    var children = null;
    if (this.props.renderContent) {
      return this.props.renderContent();
    }
    // else if (this.props.images) {
    //   console.log(this.props.images)
    //   return this.props.images.map((tmp, index_b) => (
    //     <Image
    //       key={index_b}
    //       source={{ uri: tmp.url || tmp }}
    //       style={{ width: '100%', height: 200 }}
    //       resizeMode={Image.resizeMode.contain}
    //     />
    //   ))
    // }
    else if (this.props.activeProps) {
      children = cloneElement(
        Children.only(this.state.currentChildren),
        this.props.activeProps
      );
    } else {
      children = cloneElement(
        Children.only(this.state.currentChildren)
      )
    }

    return children;
    // return this.state.currentChildren;
  }

  componentWillMount() {
    this.setState({
      currentIndex: this.props.currentIndex,
    });

    this._panResponder = PanResponder.create({
      // Ask to be the responder:
      onStartShouldSetPanResponder      : (evt, gestureState) => {
        return true; //!this.state.isAnimating;
      },
      onMoveShouldSetPanResponder       : (evt, gestureState) => {
        if (this.state.isAnimating) {
          return false;
        } else {
          return this.props.scalable && gestureState.dx > 2 || gestureState.dy > 2 || gestureState.numberActiveTouches === 2;
        }
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => !this.state.isAnimating,
      onPanResponderGrant               : (evt, gestureState) => {
        const currentTouchTimeStamp = Date.now();
        this.state.pan.setValue(0);
        this.setState({
          isPanning: true,
        });
        if (this.isDoubleTap(currentTouchTimeStamp, gestureState)) {
          this.doubleTapZoom();
        }
        this.tap(currentTouchTimeStamp, gestureState);
        this.prevTouchInfo = {
          prevTouchX        : gestureState.x0,
          prevTouchY        : gestureState.y0,
          prevTouchTimeStamp: currentTouchTimeStamp,
        };
        if (gestureState.numberActiveTouches === 2) {
          this.distant = this.distance(evt.nativeEvent.touches[ 0 ].pageX, evt.nativeEvent.touches[ 0 ].pageY, evt.nativeEvent.touches[ 1 ].pageX, evt.nativeEvent.touches[ 1 ].pageY);
        }
      },
      onPanResponderMove                : (evt, gestureState) => {
        // zoom
        if (gestureState.numberActiveTouches === 2) {
          // let dx = Math.abs(evt.nativeEvent.touches[0].pageX - evt.nativeEvent.touches[1].pageX);
          // let dy = Math.abs(evt.nativeEvent.touches[0].pageY - evt.nativeEvent.touches[1].pageY);
          // let distant = Math.sqrt(dx * dx + dy * dy);

          let distant = this.distance(evt.nativeEvent.touches[ 0 ].pageX, evt.nativeEvent.touches[ 0 ].pageY, evt.nativeEvent.touches[ 1 ].pageX, evt.nativeEvent.touches[ 1 ].pageY);
          let scale = distant / this.distant * this.state.lastScale;
          this.setState({ scale });
        }
        // translate
        else {
          if (gestureState.numberActiveTouches === 1 && this.state.scale > 1) {
            let offsetX = this.state.lastX + gestureState.dx / this.state.scale;
            let offsetY = this.state.lastY + gestureState.dy / this.state.scale;
            this.setState({ offsetX, offsetY });
            this.hideIcons = true;
            clearTimeout(this.tap4toggle);
          } else { // swipe
            if (this.props.galleryMode && !this.state.isSwiping && Math.abs(gestureState.dx) > DRAG_SWIPE_THRESHOLD) {
              this.swiper(gestureState.dx < 0)
              this.hideIcons = false;
            }
            this.state.pan.setValue(gestureState.dy);
          }
        }
      },

      onPanResponderTerminationRequest: (evt, gestureState) => false,
      onPanResponderRelease           : (evt, gestureState) => {
        if (this.state.scale > 1) {
          this.setState({
            lastX    : this.state.offsetX,
            lastY    : this.state.offsetY,
            lastScale: this.state.scale
          });
        } else {
          // this.resetOverlay();
          if (Math.abs(gestureState.dy) > DRAG_DISMISS_THRESHOLD) {
            // hide overlay
            this.setState({
              isPanning   : false,
              isReleaseing: true,
              target      : {
                y      : WINDOW_HEIGHT, //gestureState.dy,//gestureState.dY, // WINDOW_HEIGHT, //gestureState.dy,
                x      : gestureState.dx, // WINDOW_WIDTH / 2, //gestureState.dx,
                // opacity: 1 - Math.abs(gestureState.dy / WINDOW_HEIGHT)
                // offsetY: 1.5 * WINDOW_HEIGHT,
                opacity: 0
              }
            });

            this.isReleaseing = true;
            this.hideIcons = false;
            this.close(gestureState.dy);
          } else {
            Animated.spring(
              this.state.pan,
              { toValue: 0, ...this.props.springConfig }
            ).start(() => {
              this.setState({ isPanning: false, isSwiping: false });
            });
          }
        }
      },
      onShouldBlockNativeResponder    : evt => false,
    });
  }

  componentDidMount() {
    if (this.props.isOpen) {
      this.open();
    }
  }

  // calculate distance between presses
  distance(x0, y0, x1, y1) {
    return Math.sqrt(Math.pow((x1 - x0), 2) + Math.pow((y1 - y0), 2));
  }

  // is one tap or not
  tap4toggle = null;

  tap(currentTouchTimeStamp, { x0, y0 }) {
    this.tap4toggle = setTimeout(() => {
      if (this.state.scale > 1) {
        this.hideIcons = true
      }
      this.toggleIcons();
    }, this.delay / 3);
  }

  // is double tap or not
  isDoubleTap(currentTouchTimeStamp, { x0, y0 }) {
    const { prevTouchX, prevTouchY, prevTouchTimeStamp } = this.prevTouchInfo;
    const dt = currentTouchTimeStamp - prevTouchTimeStamp;

    var ret = (dt < this.delay && this.distance(prevTouchX, prevTouchY, x0, y0) < this.radius);
    if (ret) {
      clearTimeout(this.tap4toggle);
    }

    return ret;
  }

  toggleIcons() {
    this.hideIcons = !this.hideIcons;
  }

  doubleTapZoom() {
    if (this.state.scale !== 1) {
      this.resetOverlay();
    } else {
      this.hideIcons = true
      this.setState({
        scale    : 1.8,
        lastScale: 1.8,
      });
    }
  }

  // reset children
  resetOverlay() {
    this.setState({
      scale    : 1,
      lastScale: 1,
      offsetX  : 0,
      offsetY  : 0,
      lastX    : 0,
      lastY    : 0
    });
  }

  open = () => {
    if (isIOS) {
      StatusBar.setHidden(true, 'fade');
    }
    this.state.pan.setValue(0);
    this.setState({
      isAnimating: true,
      target     : {
        x      : 0,
        y      : 0,
        opacity: 1,
      }
    });
    this.isReleaseing = false;

    Animated.spring(
      this.state.openVal,
      { toValue: 1, ...this.props.springConfig }
    ).start(() => {
      this.setState({ isAnimating: false });
      this.props.didOpen();
    });
  }

  swiper = (forward) => {
    var galleryKeyArray = global.gallery.get(this.props.GKey) || [];
    currentIndex = this.state.currentIndex || this.props.currentIndex;
    var nextIndex = forward ? (currentIndex + 1 >= galleryKeyArray.length ? 0 : currentIndex + 1) : (currentIndex < 1 ? galleryKeyArray.length - 1 : currentIndex - 1);

    this.setState({
      currentIndex   : nextIndex,
      currentChildren: galleryKeyArray[ nextIndex ],
      isSwiping      : true,
    });
  }

  close = (gestureStateDy) => {
    if (!gestureStateDy) {
      gestureStateDy = 0
    }

    this.hideIcons = false;
    this.props.willClose();
    if (isIOS) {
      StatusBar.setHidden(false, 'fade');
    }
    this.setState({
      currentIndex: 0,
      isAnimating : true,
    });

    Animated.parallel([
      Animated.spring(
        this.state.openVal, {
          toValue: 1, ...this.props.springConfig
        }),

      Animated.timing(this.state.pan, {
        toValue : gestureStateDy < 0 ? -WINDOW_HEIGHT : WINDOW_HEIGHT, // 目标值
        duration: 200, // 动画时间
        easing  : Easing.in // 缓动函数
      })
    ]).start(() => {
      this.setState({
        isAnimating: false,
      });
      this.props.onClose();
      this.resetOverlay();
    });

  }

  componentWillReceiveProps(props) {
    // reset dispaly also can been called here
    this.setState({
      currentChildren: props.children,
    })
    if (this.props.isOpen != props.isOpen && props.isOpen) {
      this.open();
    }
  }

  render() {
    // var galleryKeyArray = global.gallery.get(this.props.GKey);
    // console.log('render index:' + galleryKeyArray.map((e) => {return e._owner}).indexOf(this.state.currentChildren._owner));

    const {
            isOpen,
            renderHeader,
            renderFooter,
            swipeToDismiss,
            scalable,
            origin,
            backgroundColor,
            currentIndex,
          } = this.props;

    const {
            isPanning,
            isAnimating,
            openVal,
            target,
          } = this.state;


    const lightboxOpacityStyle = {
      opacity: openVal.interpolate({ inputRange: [ 0, 1 ], outputRange: [ 0, target.opacity ] })
    };


    // 拖动或是释放时动态隐藏图片
    var imageOpacityStyle = {}
    if (isPanning || this.isReleaseing) {
      imageOpacityStyle = {
        opacity: this.state.pan.interpolate({
          inputRange : [ -WINDOW_HEIGHT, 0, WINDOW_HEIGHT ],
          outputRange: [ 0.9, 1, 0.9 ]
        }),
      };
      imageOpacityStyle.top = this.state.pan;
      imageOpacityStyle.left = 0;
    }

    let handlers;
    if (swipeToDismiss || scalable) {
      handlers = this._panResponder.panHandlers;
    }

    let dragStyle = {};
    let footerAniStyle = {};
    let headerAniStyle = {};
    if (isPanning) {
      dragStyle = {
        top: this.state.pan,
      };
      lightboxOpacityStyle.opacity = this.state.pan.interpolate({
        inputRange : [ -WINDOW_HEIGHT, 0, WINDOW_HEIGHT ],
        outputRange: [ 0, 1, 0 ]
      });

      footerAniStyle.bottom = this.state.pan.interpolate({
        inputRange : [ -40, 0, 40 ],
        outputRange: [ -80, 0, -50 ]
      });

      headerAniStyle.top = this.state.pan.interpolate({
        inputRange : [ -40, 0, 40 ],
        outputRange: [ -50, 0, -80 ]
      });
    }

    const openStyle = [ styles.open, {
      left  : openVal.interpolate({ inputRange: [ 0, 1 ], outputRange: [ origin.x, target.x ] }),
      top   : openVal.interpolate({ inputRange: [ 0, 1 ], outputRange: [ origin.y, target.y ] }),
      width : openVal.interpolate({ inputRange: [ 0, 1 ], outputRange: [ origin.width, WINDOW_WIDTH ] }),
      height: openVal.interpolate({ inputRange: [ 0, 1 ], outputRange: [ origin.height, WINDOW_HEIGHT ] }),
    } ];

    const hideIconsStyle = { display: (this.hideIcons) ? 'none' : 'flex' }
    this.preScale = this.state.scale;


    const background = (<Animated.View
      style={[ styles.background, { backgroundColor: backgroundColor }, lightboxOpacityStyle ]}/>);

    const header = (
      <Animated.View style={[ styles.header, lightboxOpacityStyle, headerAniStyle, hideIconsStyle ]}>{(renderHeader ?
          renderHeader(this.close) :
          (
            <TouchableOpacity onPress={this.close} style={styles.closeButtonBox}>
              <Text style={styles.closeButton}>×</Text>
            </TouchableOpacity>
          )
      )}</Animated.View>);

    // todo when drag dispear , animation
    const content = (
      <Animated.View style={[ openStyle, dragStyle, imageOpacityStyle, {
        transform: [
          { scaleX: this.state.scale },
          { scaleY: this.state.scale },
          { translateX: this.state.offsetX },
          { translateY: this.state.offsetY }
        ]
      }
      ]} {...handlers}>
        {this.getContent()}
      </Animated.View>
    );

    const footer = (
      <Animated.View
        style={[ styles.footer, lightboxOpacityStyle, footerAniStyle, hideIconsStyle ]}>
        {(renderFooter ? renderFooter() : null)}
      </Animated.View>);

    if (this.props.navigator) {
      return (
        <View>
          {background}
          {content}
          {header}
          {footer}
        </View>
      );
    }

    return (
      <Modal visible={isOpen} transparent={true} onRequestClose={() => this.close()}>
        {background}
        {content}
        {header}
        {footer}
      </Modal>
    );
  }
}
